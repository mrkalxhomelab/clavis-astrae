# Chrome extension — setup (Tabularium on Google Drive)

The extension uses two Google permissions:

- `drive.file`: for sealed **files** (.age). It sees only the files it created itself, in the Drive folder "Clavis Astrae Tabularium".
- `documents`: for sealed **Google Docs** (Tabula). Google grants this for all your Google Docs; the extension only ever opens the document you ask it to.

It never reads other Drive files. All sealing and opening happens on your computer, and only signs or .age bytes are sent to Google.

You need Google Chrome, signed in with the Google account whose Drive you want to use.

Google's console screens change often. The names below are a guide, so check https://developers.google.com/workspace/guides/create-credentials if something looks different. [VERIFY]

## 1. Load the extension, to see its ID

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder of this project.
4. The extension appears with the ID **`ogbpmnbackopkfhlcnmokopljepbedaa`**. It is fixed by the `key` in `manifest.json`, so it is the same on every computer.

## 2. Create a Google Cloud project (free)

1. Go to https://console.cloud.google.com and create a project, for example "Clavis Astrae".
2. Go to **APIs & Services → Library** and **Enable** both **Google Drive API** and **Google Docs API**.
3. Go to **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*):
   - User type: **External**.
   - App name: Clavis Astrae. Support and developer email: yours.
   - Scopes: add `.../auth/drive.file` and `.../auth/documents`.
   - Under **Test users** (*Audience*), add your own Gmail address.
   - Leave the app in **Testing**. Nobody else can use it, and no Google review is needed.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Chrome Extension** (or *Chrome App* in older screens).
   - Item ID: `ogbpmnbackopkfhlcnmokopljepbedaa`.
   - Create, then copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

## 3. Put the Client ID in the extension

1. Open `extension/manifest.json` and replace `PASTE-YOUR-CLIENT-ID.apps.googleusercontent.com` with your Client ID.
2. In `chrome://extensions`, click the reload arrow on the extension.

## 4. Use it

**Sealed Google Docs (Tabula)**

1. Open a Google Doc in Chrome and click the extension icon, then **THIS DOCUMENT**. The first time, connect your Google account.
2. If the document is plain, press **OBSIGNA**. A new document holding only signs is created. Open it to check it works, then delete the original and empty the Drive bin.
3. If the document is sealed, type the passphrase. The text opens in the extension page, where you can edit it and press **SERVA** to seal it again.

**Sealed files (.age)**

1. Click the extension icon, then **SEALED FILES**. The Tabularium page opens.
2. Click **CONNECT GOOGLE DRIVE**. Google shows a warning that the app is unverified: this is your own test app, so choose *Continue*. Then grant access.
3. Use the page:
   - **Sigilla et mitte**: choose documents. They are sealed here and uploaded.
   - **Importa**: upload `.age` files you made in the Clavis Astrae app, so the extension can open them later.
   - **Aperi**: opens a file from the Drive list. PDFs and images open in a tab of the extension, and text is shown on the page.

## Notes

- The extension shows a "Developer mode" warning in Chrome. This is expected for a personal extension that is not on the Chrome Web Store.
- If you delete the Google Cloud project, the extension can no longer reach Drive. Your files stay in Drive and can still be opened with the app or the `age` tool.
- If you set up v1.1 before, add the Docs API and the `documents` scope in Google Cloud, then reload the extension. Chrome asks you to grant the new permission once.
- Updating the extension: run `node tools/build_extension.mjs` after changing shared code, then reload it in `chrome://extensions`.
