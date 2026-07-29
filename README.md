My personal library

What this is
- Static single-page site that opens to your Current Read.
- You can set a current read, finish it with a rating and notes, and keep a wishlist of books to read.
- Data is stored locally in your browser's localStorage (no server).

Files
- `index.html` — main page
- `styles.css` — visual styles (dark, fantasy vibes)
- `app.js` — interaction and persistence

How to run
- Open `index.html` in your browser (double-click) or serve the folder with a static server.

Data contract
- localStorage key: `otherworld_reads_v1`
- shape: { current: {title,author,cover}|null, wishlist: Array<{title,author}>, finished: Array<{title,author,cover,rating,notes,finishedAt}> }

Notes & next steps
- Could add image upload, sync to a backend, and import/export of reading lists.
- Would also be easy to add search, tags, or Goodreads/ISBN lookup.
