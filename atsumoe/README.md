# atsu.moe scripts

Userscripts for the manga site [atsu.moe](https://atsu.moe). Each one is separate, so install only the ones you want.
Both only run on atsu.moe, never on other sites.

## Install

1. Install the **Tampermonkey** extension in your browser.
2. Click a script's install link below, then click **Install** on the Tampermonkey page.
3. Reload any atsu.moe tabs you have open.

Tampermonkey keeps the scripts up to date from this folder.

## Atsu Comfy Reader: smooth arrow-key scrolling

**[Install atsu-comfy-reader.user.js](https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/atsumoe/atsu-comfy-reader.user.js)**

Works in atsu's vertical (scroll) reading mode.

| Key | What it does |
|---|---|
| `↓` / `↑` tap | a small smooth step |
| `↓` / `↑` hold | glides at an even speed and stops when you let go |
| `Shift` + arrows | faster, also while holding |

Every other key works as normal. Typing in comment boxes isn't affected.

To change the feel, edit the numbers at the top of the script in Tampermonkey (`TAP`, `GLIDE`, `FAST`).

## Atsu Next Chapters: countdown to your next chapters

**[Install atsu-next-chapters.user.js](https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/atsumoe/atsu-next-chapters.user.js)**

A timeline down the left side of atsu's home page (sign in to atsu first). For every ongoing series in your
**Reading** bookmarks that you're caught up on, it counts down to the next chapter:

- **Out now**: a new chapter is up and you haven't read it yet. Click it to open that chapter.
- **Coming up**: series grouped by day (Today, Tomorrow, Friday 30 Oct...), each with a countdown and a bar that
  empties as the chapter gets closer. `≈` means the series isn't regular, so the time is a rough guess.
- **Later**: series more than two weeks away.
- **Waiting**: series atsu marks as on hiatus, ones well past their usual gap ("probably on a break"), and new
  series without enough chapters yet to tell.

Hover a card and click `✕` to hide a series, and `↻` checks again now. In a narrow window the panel folds into a
small `⏱` tab on the left edge.

**Where the times come from:** atsu's own upload history. Each series' next chapter is predicted from the gaps
between its last releases (weekly, every 2 weeks, monthly...), so it shows when chapters usually land on atsu. Fan
translations have no official schedule, so treat the times as good estimates, not promises.

The first home-page visit looks at all your Reading bookmarks once, which takes a few seconds. After that the
script reuses what it saved and only re-checks series that are due soon. It does nothing while you read a chapter.
