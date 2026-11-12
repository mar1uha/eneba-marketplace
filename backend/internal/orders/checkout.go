package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"eneba-marketplace/backend/internal/catalog"
)

// Checkout turns the cart into a pending order and reserves its keys for ReservationTTL. A user has
// at most one open checkout: starting a new one closes the previous order and returns its keys.
// If any line lacks stock, nothing is reserved and a StockError lists what is available.
func (s *Service) Checkout(ctx context.Context, userID int64) (Order, error) {
	var orderID int64
	err := s.inUserTx(ctx, userID, func(tx pgx.Tx) error {
		if err := closeOpenOrders(ctx, tx, userID); err != nil {
			return err
		}

		type line struct {
			offerID         int64
			quantity, price int
			active          bool
		}
		rows, _ := tx.Query(ctx, `
			SELECT i.offer_id, i.quantity, ofr.price_cents, ofr.is_active
			FROM cart_items i JOIN offers ofr ON ofr.id = i.offer_id
			WHERE i.user_id = $1 ORDER BY i.offer_id`, userID)
		lines, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (line, error) {
			var l line
			return l, row.Scan(&l.offerID, &l.quantity, &l.price, &l.active)
		})
		if err != nil {
			return fmt.Errorf("load cart: %w", err)
		}
		if len(lines) == 0 {
			return ErrEmptyCart
		}

		var problems []StockProblem
		total := 0
		for _, l := range lines {
			if !l.active {
				problems = append(problems, StockProblem{OfferID: l.offerID, Available: 0})
			}
			total += l.price * l.quantity
		}
		if problems != nil {
			return &StockError{Problems: problems}
		}

		var reservedUntil time.Time
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (user_id, total_cents, reserved_until) VALUES ($1, $2, now() + $3::interval)
			RETURNING id, reserved_until`, userID, total, ReservationTTL).Scan(&orderID, &reservedUntil); err != nil {
			return fmt.Errorf("create order: %w", err)
		}

		// One statement per line creates the order item and reserves its keys; all lines go in one round trip.
		// SKIP LOCKED: concurrent checkouts take different keys instead of waiting, so a key is never
		// handed to two orders and the last key goes to exactly one buyer.
		batch := &pgx.Batch{}
		for _, l := range lines {
			batch.Queue(`
				WITH item AS (
				    INSERT INTO order_items (order_id, offer_id, unit_price_cents, quantity)
				    VALUES ($1, $2, $3, $4::int) RETURNING id
				)
				UPDATE digital_keys d SET status = 'reserved', order_item_id = (SELECT id FROM item), reserved_until = $5
				FROM (
				    SELECT k.id FROM digital_keys k
				    WHERE k.offer_id = $2 AND `+catalog.KeyForSale+`
				    ORDER BY k.id LIMIT $4::int
				    FOR UPDATE SKIP LOCKED
				) picked
				WHERE d.id = picked.id`, orderID, l.offerID, l.price, l.quantity, reservedUntil)
		}
		br := tx.SendBatch(ctx, batch)
		for _, l := range lines {
			tag, err := br.Exec()
			if err != nil {
				_ = br.Close()
				return fmt.Errorf("reserve keys: %w", err)
			}
			if got := int(tag.RowsAffected()); got < l.quantity {
				problems = append(problems, StockProblem{OfferID: l.offerID, Available: got})
			}
		}
		if err := br.Close(); err != nil {
			return fmt.Errorf("reserve keys: %w", err)
		}
		if problems != nil {
			return &StockError{Problems: problems}
		}
		return nil
	})
	if err != nil {
		return Order{}, err
	}
	return s.Order(ctx, userID, orderID)
}

// Pay charges the simulated card. Paying an order that is already paid returns it unchanged, so a
// double click or a retried request never charges twice. A declined card keeps the reservation, so
// the buyer can try another card until the timer runs out.
func (s *Service) Pay(ctx context.Context, userID, orderID int64, card Card) (Order, error) {
	ch, err := card.check(time.Now())
	if err != nil {
		return Order{}, err
	}

	// Expiry and declines are recorded (commit) and then reported as errors.
	var outcome error
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		status, total, timedOut, err := lockOrder(ctx, tx, userID, orderID)
		if err != nil {
			return err
		}
		switch status {
		case "paid":
			return nil
		case "cancelled", "expired":
			return ErrOrderClosed
		}

		// Lock the order's keys before checking them, so no other checkout can take them meanwhile.
		rows, _ := tx.Query(ctx, `
			SELECT k.id FROM digital_keys k JOIN order_items oi ON oi.id = k.order_item_id
			WHERE oi.order_id = $1 AND k.status = 'reserved'
			FOR UPDATE OF k`, orderID)
		held, err := pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return fmt.Errorf("lock keys: %w", err)
		}
		var wanted int
		if err := tx.QueryRow(ctx, `SELECT sum(quantity)::int FROM order_items WHERE order_id = $1`, orderID).Scan(&wanted); err != nil {
			return fmt.Errorf("count items: %w", err)
		}
		if timedOut || len(held) < wanted {
			if _, err := tx.Exec(ctx, `UPDATE orders SET status = 'expired' WHERE id = $1`, orderID); err != nil {
				return err
			}
			outcome = ErrReservationExpired
			return releaseKeys(ctx, tx, orderID)
		}

		if ch.decline != nil {
			outcome = ch.decline
			_, err := tx.Exec(ctx, `
				INSERT INTO payments (order_id, amount_cents, status, decline_code, card_brand, card_last4)
				VALUES ($1, $2, 'declined', $3, $4, $5)`, orderID, total, ch.decline.Code, ch.brand, ch.last4)
			return err
		}

		batch := &pgx.Batch{}
		batch.Queue(`UPDATE digital_keys SET status = 'sold', sold_at = now(), reserved_until = NULL WHERE id = ANY($1)`, held)
		batch.Queue(`
			INSERT INTO payments (order_id, amount_cents, status, card_brand, card_last4)
			VALUES ($1, $2, 'succeeded', $3, $4)`, orderID, total, ch.brand, ch.last4)
		batch.Queue(`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1`, orderID)
		batch.Queue(`
			DELETE FROM cart_items i USING order_items oi
			WHERE oi.order_id = $1 AND i.user_id = $2 AND i.offer_id = oi.offer_id`, orderID, userID)
		if err := tx.SendBatch(ctx, batch).Close(); err != nil {
			return fmt.Errorf("complete payment: %w", err)
		}
		return nil
	})
	if err == nil {
		err = outcome
	}
	if err != nil {
		return Order{}, err
	}
	return s.Order(ctx, userID, orderID)
}

// Cancel closes an unpaid order and returns its keys to stock. Cancelling a closed order changes nothing.
func (s *Service) Cancel(ctx context.Context, userID, orderID int64) (Order, error) {
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		status, _, _, err := lockOrder(ctx, tx, userID, orderID)
		switch {
		case err != nil:
			return err
		case status == "paid":
			return ErrOrderClosed
		case status != "pending":
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET status = 'cancelled' WHERE id = $1`, orderID); err != nil {
			return err
		}
		return releaseKeys(ctx, tx, orderID)
	})
	if err != nil {
		return Order{}, err
	}
	return s.Order(ctx, userID, orderID)
}

// lockOrder locks one of the user's orders and reads its stored status, total, and whether its
// reservation has run out. Other users' orders are reported as not found.
func lockOrder(ctx context.Context, tx pgx.Tx, userID, orderID int64) (status string, total int, timedOut bool, err error) {
	err = tx.QueryRow(ctx, `
		SELECT status, total_cents, reserved_until < now() FROM orders
		WHERE id = $1 AND user_id = $2 FOR UPDATE`, orderID, userID).Scan(&status, &total, &timedOut)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return status, total, timedOut, err
}

// closeOpenOrders closes the user's unpaid orders (expired if their timer ran out, cancelled otherwise)
// and returns their keys.
func closeOpenOrders(ctx context.Context, tx pgx.Tx, userID int64) error {
	rows, _ := tx.Query(ctx, `
		UPDATE orders SET status = CASE WHEN reserved_until < now() THEN 'expired' ELSE 'cancelled' END
		WHERE user_id = $1 AND status = 'pending'
		RETURNING id`, userID)
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return fmt.Errorf("close open orders: %w", err)
	}
	return releaseKeys(ctx, tx, ids...)
}

// releaseKeys returns keys still held by the given orders to stock.
func releaseKeys(ctx context.Context, tx pgx.Tx, orderIDs ...int64) error {
	if len(orderIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE digital_keys k SET status = 'available', order_item_id = NULL, reserved_until = NULL
		FROM order_items oi
		WHERE oi.order_id = ANY($1) AND k.order_item_id = oi.id AND k.status = 'reserved'`, orderIDs)
	if err != nil {
		return fmt.Errorf("release keys: %w", err)
	}
	return nil
}
