# Chrome extension — setup (Tabularium on Google Drive)

The extension reads and writes **only the files it created itself** in your Drive folder "Clavis Astrae Tabularium" (Google scope `drive.file`). It never sees the rest of your Drive. All sealing and opening happens on your computer.

You need Google Chrome, signed in with the Google account whose Drive you want to use.

Google's console screens change often. The names below are a guide, so check https://developers.google.com/workspace/guides/create-credentials if something looks different. [VERIFY]

## 1. Load the extension, to see its ID

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder of this project.
4. The extension appears with the ID **`ogbpmnbackopkfhlcnmokopljepbedaa`**. It is fixed by the `key` in `manifest.json`, so it is the same on every computer.

## 2. Create a Google Cloud project (free)

1. Go to https://console.cloud.google.com and create a project, for example "Clavis Astrae".
2. Go to **APIs & Services → Library**, search **Google Drive API**, and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*):
   - User type: **External**.
   - App name: Clavis Astrae. Support and developer email: yours.
   - Scopes: add `.../auth/drive.file`.
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

1. Click the extension icon, then **APERI**. The Tabularium page opens.
2. Click **CONNECT GOOGLE DRIVE**. Google shows a warning that the app is unverified: this is your own test app, so choose *Continue*. Then grant access.
3. Use the page:
   - **Sigilla et mitte**: choose documents. They are sealed here and uploaded.
   - **Importa**: upload `.age` files you made in the Clavis Astrae app, so the extension can open them later.
   - **Aperi**: opens a file from the Drive list. PDFs and images open in a tab of the extension, and text is shown on the page.

## Notes

- The extension shows a "Developer mode" warning in Chrome. This is expected for a personal extension that is not on the Chrome Web Store.
- If you delete the Google Cloud project, the extension can no longer reach Drive. Your files stay in Drive and can still be opened with the app or the `age` tool.
- Updating the extension: run `node tools/build_extension.mjs` after changing shared code, then reload it in `chrome://extensions`.
