

## Add the extension to chromium based browsers

- go to `Manage extensions`
- enable `developer mode`
- click `load unpacked extension`
- select the folder that contains the `manifest.json` file



## How it works

- enable/disable only disables the extension/background site (changes are still tracked but not processed by the background)
  - content-script is still working



## Problems

- does not work because SSE is disabled after ~1 min?????