MAL Paste Codes  (mal-paste-codes.user.js, v1.0.1, 2026-11-18)
===============================================================

Paste a link into a MyAnimeList post, comment or message and it turns into the code for it by itself.
Tampermonkey script, myanimelist.net only.

WHAT BECOMES WHAT
  - Picture / GIF link (.gif .png .jpg .webp .avif, Tenor, Imgur, ibb, ...)   ->  [img]link[/img]
      https://media.tenor.com/giU9QtwVZg4AAAAM/anime-fran.gif
      ->  [img]https://media.tenor.com/giU9QtwVZg4AAAAM/anime-fran.gif[/img]
  - YouTube link (watch, youtu.be, shorts, live)                              ->  [yt]video id[/yt]  (MAL's player)
  - Video file link (.mp4 .webm .mov)                                         ->  [url=link]link[/url]
      MAL has no player for video files, so it becomes a clickable link.
  - Imgur .gifv                                                               ->  [img] with the .gif
  - Several links pasted at once (one per line) each get their code.

WHERE
  Forum posts, private messages, club pages, blog, profile comments, About Me / signature: every big MAL editor
  and the comment boxes. List notes and reviews are left alone (MAL shows no codes there).

LEFT ALONE
  - Any other link (an anime page, a tweet ...), and text that has words as well as a link.
  - A link pasted INSIDE a code you typed yourself, e.g. between [img] and [/img] or after [url=.
  - The MAL DMs chat box (it does the same itself).
  - Ctrl+Z takes the code out again.

INSTALL
  With Tampermonkey installed, open this link and press Install:
  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-paste-codes.user.js
  Reload your MAL tabs. Later versions arrive by themselves.

NOT TRIED YET
  MAL's phone layout.
