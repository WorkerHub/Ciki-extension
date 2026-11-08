# Ciki Helper

[中文](README.md) · English

Clip a source documentation page into Ciki in one click: the extension reads the page body and
original attachment images using your current browser session, converts them into Ciki's TipTap
structure, and writes only after you approve in the confirmation window. It also handles "paste
re-fetch" on Ciki edit pages: images marked in yellow that were not stored are fetched from the
original source site by the extension.

Ciki Helper (Ciki助手) is a Chrome extension (Manifest V3). The extension UI is currently in
Chinese; the original labels are included in parentheses below.

## Features

- **Full-page clipping**: title, body, code blocks, tables, task lists, callout panels and original
  attachment images are imported together.
- **Colors come along**: text colors, highlights and table cell backgrounds are imported too. Ciki
  only accepts `#rrggbb`-style values, so named and semi-transparent colors fall back to plain
  text.
- **Choose a space**: pick the destination space in the confirmation window; the parent page list
  follows the selected space. The last used space is preselected, and the completion report states
  where the page landed.
- **Completion report**: lists the result for every image, the reason an image was not stored,
  attachments kept as links only, and dropped navigation macros.
- **Paste re-fetch**: when an image pasted into a Ciki edit page only has an external URL, the
  extension answers Ciki's request and fetches the original image from the source site.
- **One page at a time**: every run is started by your click; there is no batch mode and no
  background polling.

## Installation

On [Releases](https://github.com/WorkerHub/Ciki-helper/releases/latest), download the extension zip
from the latest release's Assets (the one uploaded by the project, not the auto-generated Source
code archive). No dependencies and no build step required.

1. Unzip it into a permanent folder (do not delete or move it later) and make sure `manifest.json`
   sits directly inside. Some archives contain an extra folder level — pick the level that contains
   `manifest.json`.
2. Open `chrome://extensions/` in Chrome and turn on Developer mode in the top-right corner.
3. Click "Load unpacked" and select the folder from step 1.
4. Click the extension icon in the toolbar (if it is hidden, use the puzzle-piece menu next to the
   address bar) → "Settings" (设置) and complete the configuration below.

**Updating**: download the new zip, unzip it over the same folder (keeping `manifest.json` at the
same level), then click the reload button on the extension card in `chrome://extensions/`. The
browser loads the extension from this folder, so deleting or moving the folder disables it.

## Configuration

Click the extension icon → "Settings" (设置), fill in the three fields, then click "Save and test"
(保存并测试):

- **Source site URL** (源站地址): the site where you read the documentation. Use the site root
  (e.g. `https://wiki.example.com`); if the site lives under a path such as `/wiki`, include it.
- **Ciki URL** (ciki 地址): e.g. `https://ciki.example.com`.
- **Import token** (导入令牌): generate it on the Ciki settings page and paste it here. The
  plaintext token stays on this machine (`chrome.storage.local`); it is not synced with your
  account and is not written to logs.

When you save, the browser asks for permission for each of these two domains. The extension has no
persistent access to all sites and does not read cookies: requests carry only the current browser
session, exactly as if you opened the page yourself in the same browser. You can revoke site access
at any time from the extension details page in `chrome://extensions/`.

"Save and test" really calls the source site's read-only API and Ciki's import API; configuration
is complete only when both succeed.

## Usage

- **Full-page clipping**: open the source content page you want to clip (keep it logged in) → click
  "剪藏到 Ciki" (Clip to Ciki) next to the title (if no title is found, the button is in the
  top-right corner; you can also click the extension icon and then "剪藏到 Ciki"). In the window,
  check the title, choose the space and parent page (the parent list follows the space), choose
  update / save as new / cancel when a page with the same title exists, then click "开始剪藏"
  (Start clipping). The final page offers "在 ciki 打开" (Open in Ciki) and a completion report.
- **Paste re-fetch**: after pasting content with external images into a Ciki edit page, the
  extension automatically answers Ciki's requests and fetches the original image bytes from the
  source site. On success, Ciki replaces the image with the uploaded URL in the editor. On failure,
  the image stays marked in yellow; retry from the image block in Ciki, and the failure reason is
  shown in the extension popup.

## Development

To modify the code or build it yourself, use Node.js 22+ and pnpm:

```bash
pnpm install        # install dependencies
pnpm dev            # dev preview of the extension pages
pnpm build          # build into dist/
pnpm typecheck      # type check
pnpm lint           # biome checks
pnpm test           # vitest
pnpm fixture        # local fixture servers for development
```

`pnpm build` produces `dist/`, which is the loadable extension folder: load it as described in steps
2–4 of Installation, then configure the source site and Ciki URLs.

## License

[MIT](LICENSE)
