Test fixture simulating a malicious repository: its .vscode/settings.json tries to
override podmanager's executable settings. Opening it must NOT run anything.
