<p align="center">
    <img src="static/logo.jpg" alt="logo" width="128" height="128" />
</p>

<h1 align="center">🔍SelectorGadget-Zen</h1>

<p align="center">
    SelectorGadget Zen is similar extension for Zen (Firefox) based on original <a href="https://github.com/cantino/selectorgadget"> SelectorGadget</a> with replacement of <kbd>diff_match_patch</kbd> to use Longest Common Subsequence (LCS) algorithm.
</p>

![usage](static/usage.gif)

### Prerequisites

-   [Node.js and npm](https://nodejs.org/)
-   A Firefox-based browser (e.g., Firefox, Zen Browser)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/dimitryzub/selector-gadget-zen.git
    cd selector-gadget-zen
    ```

2.  **Install dependencies:**
    This will install TypeScript, `web-ext`, and other development tools.
    ```bash
    npm install
    ```

3.  **Build the extension:**
    ```bash
    npm run build
    ```

## Running for Development

The `start` command in `package.json` is used to launch the browser with the extension installed. It may need to be configured for your specific setup.

### How to Configure the `start` Command

The default `start` command in `package.json` looks like this:

```json
"start": "web-ext run --source-dir ./dist --firefox=\"...\" --firefox-profile=\"...\""
```

You need to provide the correct paths for `--firefox` and `--firefox-profile`.

#### 1. Finding the Browser Path (`--firefox`)

This is the path to your browser's executable file.
-   **Example for Zen Browser:** `"C:\\Program Files\\Zen Browser\\zen.exe"`
-   **Example for Firefox:** `"C:\\Program Files\\Mozilla Firefox\\firefox.exe"`

Find the path on your system and update the command.

#### 2. Finding the Profile Path (`--firefox-profile`)

To avoid losing your logins and settings on every run, you should use a persistent development profile.

1.  **Open the Profile Manager:** Make sure your browser is closed. Open a Command Prompt (CMD) and run:
    ```cmd
    "C:\Program Files\Zen Browser\zen.exe" -P
    ```
    (Replace the path with your browser's path).

2.  **Create a New Profile:** In the window that appears, click "Create Profile...", give it a memorable name (e.g., `web-ext-dev`), and click "Finish".

3.  **Get the Profile's Full Path:**
    -   Start your browser using the new profile you just created.
    -   In the address bar, navigate to `about:profiles`.
    -   Find your new profile (e.g., `web-ext-dev`) in the list.
    -   Copy its **Root Directory** path. It will be an absolute path like `C:\Users\YourName\AppData\Roaming\Zen\Profiles\xxxxxxxx.web-ext-dev`.

4.  **Update `package.json`:**
    -   Paste the full path into the `--firefox-profile` argument.
    -   **Important:** In the JSON file, you must replace every single backslash (`\`) with a double backslash (`\\`).

**Final Example `start` command:**

```json
"start": "web-ext run --source-dir ./dist --firefox=\"C:\\Program Files\\Zen Browser\\zen.exe\" --firefox-profile=\"C:\\Users\\USER\\AppData\\Roaming\\Zen\\Profiles\\abcdefg.web-ext-dev\""
```

Once configured, you can run the extension with:

```bash
npm run start
```