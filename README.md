# Anime site scripts

Userscripts for anime streaming sites.

## Anikoto Capture (anikototv.to)

Screenshots and recordings of the episode you're watching, saved straight into **a folder you choose** (Windows).

| Key | What it does |
|---|---|
| `]` | screenshot of the video at full resolution (the best JPEG under 200 KB) |
| `=` / `-` | start / stop recording (MP4 with sound) |
| `[` | subtitles in screenshots and recordings on / off |
| `Esc` / `W` | leave / re-enter window mode (the player fills the browser window) |

The keys only work on episode pages. Only the video is captured, never the player's controls.
Files are named like `2026-10-25 14-03-27 The Apothecary Diaries S3E1.jpg` and never overwrite each other.

### Install

1. Install the **Tampermonkey** extension in your browser.
2. Open **[anime-capture.user.js](https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/anikototv/anime-capture.user.js)** and click **Install**.
3. Set up the small helper that saves the files (a browser can't save into a folder of its choice):
   1. Install [Python 3](https://www.python.org/downloads/) (tick "Add python.exe to PATH") and
      [ffmpeg](https://ffmpeg.org/download.html) (on PATH, or put `ffmpeg.exe` in the `anikototv` folder).
   2. Download this repo (**Code > Download ZIP**), unzip it and open the `anikototv` folder.
   3. In that folder run `pip install -r requirements.txt`.
   4. **Choose your save folder** (see below).
   5. Double-click `start-helper.vbs` (it runs hidden, no window). To start it with Windows, put a shortcut to
      `start-helper.vbs` in your Startup folder (press Win+R, type `shell:startup`).
4. Open an episode on anikototv.to and press `]`. A small "✓ Screenshot saved" shows in the corner.

### 📁 Choose your own save folder

> [!IMPORTANT]
> Screenshots **and** recordings both go into one folder. If you don't choose one, they go to
> `Pictures\Anime captures`.

1. In the `anikototv` folder, make a copy of `settings.example.json` and rename the copy to **`settings.json`**.
2. Open `settings.json` with Notepad and put your folder between the quotes. You can paste it straight from the
   File Explorer address bar:

   ```
   {
     "save_folder": "D:\Anime captures"
   }
   ```

3. Save the file. That's it: the next screenshot or recording goes there (no restart needed). The folder is
   created if it doesn't exist yet.

Tampermonkey keeps the script up to date from this repo.
