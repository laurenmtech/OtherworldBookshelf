My personal library

What this is
- Static single-page site that opens to your Current Reads.
- It exists so you remember what you read. Reading a book a day on a Kindle means no cover ever sits on a shelf and the titles go — this gives them back, so there's an answer when someone asks what you've read lately.
- Search for a book and add it in one tap, keep up to three on the go at once, and finish or set one down whenever you like.
- Keep a TBR pile of what's next, and a record of everything you've read.
- Ask "What should I read?" for suggestions built from your own taste, checked against Open Library so nothing invented gets through.
- See what your library has, and link straight to your own bookshop.
- Data is stored in a database so you never lose your list
- Nothing is shared. No feed, no followers, no ratings anyone else sees — and the recommender sends a short summary of your taste, never your shelf.

Files
- `index.html` — main page
- `styles/` — visual styles, and a vibe you can change
- `js/` — interaction and persistence
- `ARCHITECTURE.md` — where things live and how state flows

How to run
- Serve the folder with a static server: `python3 -m http.server 8000`, then open http://localhost:8000. Opening `index.html` directly won't work — the app needs a real origin.
- Go to laurenmtech.github.io/books and tap to add to homescreen on your phone for the ideal experience


