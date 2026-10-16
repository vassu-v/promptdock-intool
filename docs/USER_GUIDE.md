# PromptDock: User Guide

PromptDock keeps your favourite AI prompts one shortcut away. Press a key, type a couple of
words, press Enter, and the prompt is typed into whatever you were using: ChatGPT,
Antigravity, Claude, an IDE, an email.

> The app shows a short tour the first time it opens. You can replay it any time:
> **⚙ Settings → Show the tour again**.

---

## 1. Install

Pick one:

| File | Use it when |
|---|---|
| `PromptDock-Setup-x.y.z.exe` | You want it installed with Start menu and desktop shortcuts. No admin rights needed. |
| `PromptDock-Portable-x.y.z.exe` | You want to run it from a folder or USB stick without installing. Your prompts are saved in a `PromptDock-data` folder next to the .exe. |

**Windows may warn you** ("Windows protected your PC") because the app isn't signed by a
paid certificate. Click **More info → Run anyway**.

After it starts, PromptDock lives in the background:
- a small round **`>_` bubble** sits at the right edge of your screen (drag it anywhere), and
- an icon appears in the **system tray**. If you don't see it, click the `^` arrow near the clock.

## 2. Open it

Any of these work:
- Press **Win + Alt + P** (the default shortcut; see the note below).
- Click the **`>_` bubble**.
- Click the **tray icon**.

Press the shortcut again, press **Esc**, or click anywhere else to close it.

> **Why not Ctrl + Win + P?** Windows reserves that shortcut on many PCs, so PromptDock
> automatically picks the first free one: Win+Alt+P, then Ctrl+Alt+P, then Ctrl+Shift+Space.
> To choose your own: **⚙ Settings → Global hotkey**, click the box, press the keys you want.

## 3. Use a prompt

1. Click into the place you want the text to go, e.g. a chat box.
2. Open PromptDock and **type to search**. Small typos are fine.
   Type `#tag` to show only prompts with that tag, e.g. `#code`.
3. Use **↑ / ↓** to pick one and press **Enter**.
4. PromptDock closes and **pastes the prompt** where your cursor was.

**Want it on the clipboard instead?** Press **Ctrl + Enter**. Then paste it wherever you
like with Ctrl + V.

## 4. Fill in the blanks (slots)

A prompt can contain blanks written in double curly brackets:

```
Review this {{language:TypeScript}} code and explain it to a {{audience}}.
```

- `{{audience}}` is a blank you fill in each time.
- `{{language:TypeScript}}` is a blank with a **default**: press Enter to keep "TypeScript", or type something else.

When you use a prompt with blanks, PromptDock shows a small form:
- Type a value and press **Enter** to go to the next blank.
- On the last blank, **Enter** fills everything in and pastes it.
- A **preview** at the bottom shows the finished text as you type.

PromptDock **remembers what you typed** for each blank name, so next time it's pre-filled.
These values stay on your computer only. Change or clear them in **⚙ Settings → Saved slot values**.

## 5. Combine several prompts

1. Highlight a prompt and press **Tab**. It's added to the *Compose* bar at the top (✓ mark).
2. Search for another one and press **Tab** again. Repeat as needed.
3. Press **Enter**. The prompts are joined in the order you picked them, with any blanks
   filled in, and pasted as one.

Remove one from the bar with its **×**. Ctrl + click on a result also adds or removes it.

## 6. Add and edit prompts

| To… | Do this |
|---|---|
| Add a new prompt | Press **Ctrl + N** or click **＋** |
| Edit a prompt | Highlight it and press **Ctrl + E**, or **right-click** it |
| Save | **Ctrl + S** or the Save button |
| Turn a word into a blank | Select it in the text and click **Make selection a {{slot}}** |
| Keep a prompt at the top | Tick **Pinned** (shows a ★) |
| Delete | Open it, click **Delete**, then click again to confirm |

Tags are comma-separated, e.g. `code, review`. The title is optional; the first line is
used if you leave it empty.

## 7. Settings (⚙ or Ctrl + ,)

| Setting | What it does |
|---|---|
| Global hotkey | The shortcut that opens PromptDock |
| Paste automatically | Off = PromptDock only copies, and you paste yourself |
| Show floating bubble | Hide or show the `>_` bubble (also in the tray menu) |
| Start with Windows | Launch PromptDock when you sign in |
| Panel opacity | How see-through the panel is |
| Separator | What goes between combined prompts: blank line, `---` line, or new line |
| Semantic search | Finds prompts by *meaning*, e.g. "phone layout" finds "Make UI responsive". Downloads a small model (~23 MB) the first time, then works offline. **Remove model** deletes it again. |
| Saved slot values | Edit or forget remembered blank values |
| Import / Export JSON | Back up your prompts, or move them to another PC. Importing skips prompts you already have. |

## 8. Keyboard cheat sheet

| Key | Action |
|---|---|
| **Win + Alt + P** | Open / close |
| ↑ ↓ | Move |
| Enter | Use (fill blanks → paste) |
| Ctrl + Enter | Copy only |
| Tab | Add to / remove from Compose |
| Ctrl + E / right-click | Edit |
| Ctrl + N | New prompt |
| Ctrl + , | Settings |
| Esc | Clear search → close; in other screens, go back |

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| The shortcut does nothing | Another app may have taken it. Open PromptDock from the bubble or tray, go to **Settings → Global hotkey** and pick a different one. The tray icon's tooltip shows the active shortcut. |
| Nothing gets pasted | Some apps run "as administrator", and Windows blocks other apps from typing into them. Use **Ctrl + Enter** to copy, then paste yourself. If your company PC blocks PowerShell, turn off *Paste automatically* and paste yourself. |
| It pasted into the wrong place | Click into the target box **before** opening PromptDock. If you opened it from the tray, it pastes into the last app you used. |
| My clipboard changed | Using a prompt puts its text on the clipboard; that is how pasting works. |
| The bubble disappeared | Turn it back on from the tray menu (**Show bubble**) or Settings. If you unplugged a monitor it was on, it moves back to your main screen on next start. |
| Semantic search shows an error | It needs internet **once** to download the model. Connect and turn it on again. Normal search keeps working either way. |
| Panel closed while I was editing | Clicking outside the panel closes it. Your unsaved edit is kept; reopen it to continue. |
| "Windows protected your PC" | Click **More info → Run anyway**. The app is unsigned, not harmful. |

## 10. Where your data lives

- **Installed version:** `%APPDATA%\promptdock\promptdock.sqlite`
- **Portable version:** `PromptDock-data\` next to the .exe

Settings shows the exact path at the bottom. Nothing is sent anywhere. The only network
access ever made is the one-time model download, and only if you turn on semantic search.

## 11. Uninstall

Installed: **Windows Settings → Apps → PromptDock → Uninstall**. To also remove your
prompts, delete `%APPDATA%\promptdock`. Portable: delete the .exe and its `PromptDock-data` folder.
