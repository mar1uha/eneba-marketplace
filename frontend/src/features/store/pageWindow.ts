/** Pages to show: first, last, and the current page with its neighbours; a gap of one page is filled in. */
export function pageWindow(page: number, totalPages: number): Array<number | 'gap'> {
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b)
  const out: Array<number | 'gap'> = []
  pages.forEach((p, i) => {
    const gap = i > 0 ? p - pages[i - 1] : 1
    if (gap === 2) out.push(p - 1)
    else if (gap > 2) out.push('gap')
    out.push(p)
  })
  return out
}
