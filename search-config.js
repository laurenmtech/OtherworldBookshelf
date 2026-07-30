// Google Books API key.
//
// COMMITTED ON PURPOSE, exactly like firebase-config.js. This key is read-only,
// restricted by HTTP referrer to this site, restricted to the Books API alone,
// and capped at a daily quota. There is nothing behind it to protect: it buys
// public book metadata and nothing else. A static site served from GitHub Pages
// has no server to hide it on, and hiding it would mean adding one.
//
// Restrict it in the Google Cloud console before shipping it:
//   Application restrictions → Websites → laurenmtech.github.io/*
//                                         localhost:8000/*
//   API restrictions        → Restrict key → Books API
//
// Empty is a supported state. With no key, Google Books is simply off and Open
// Library answers alone — the search still works, it just won't know about
// books published in the last few months.
window.GOOGLE_BOOKS_KEY = 'AIzaSyDzAslMQIaO-UpwChFhy0Y8OCcoMVEboao';
