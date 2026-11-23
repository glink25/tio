#pragma once
char *tio_workspace_call(const char *database, const char *space, const char *request);
void tio_release_reply(char *reply);
char *tio_native_call(const char *database, const char *request);

void tio_activate_foreground(void);
