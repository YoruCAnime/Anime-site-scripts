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
   2. Download this repo (**Code > Download ZIP**) and unzip it. You get a folder called `Anime-site-scripts-main`;
      open the `anikototv` folder inside it. Keep this folder: the helper and its settings live here.
   3. In that folder run `pip install -r requirements.txt`.
   4. Double-click `start-helper.vbs` (it runs hidden, no window). To start it with Windows, put a shortcut to
      `start-helper.vbs` in your Startup folder (press Win+R, type `shell:startup`).
4. Open an episode on anikototv.to and press `]`. A small "✓ Screenshot saved" shows in the corner.
5. Your files are in `Pictures\Anime captures`. To save somewhere else, see below.

### 📁 Choose your own save folder

> [!IMPORTANT]
> The save folder is **not** set in Tampermonkey. It's in a file called **`settings.json`** in the `anikototv`
> folder you downloaded, right next to `start-helper.vbs`, for example:
>
> `C:\Users\<you>\Downloads\Anime-site-scripts-main\anikototv\settings.json`
>
> The helper makes this file the first time it starts. Screenshots **and** recordings both go into this one folder.

1. Open `settings.json` with Notepad (right-click > **Open with** > **Notepad**).
2. Put your folder between the quotes. You can paste it straight from the File Explorer address bar:

   ```
   {
     "save_folder": "D:\Anime captures"
   }
   ```

3. Save the file. That's it: the next screenshot or recording goes there (no restart needed). The folder is
   created if it doesn't exist yet.

Can't find the `anikototv` folder? It's wherever you unzipped the download: search File Explorer for
`start-helper.vbs`.

Tampermonkey keeps the script up to date from this repo.
