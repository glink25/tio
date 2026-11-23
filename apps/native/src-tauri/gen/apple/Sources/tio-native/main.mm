#include "bindings/bindings.h"

extern "C" char *tio_apple_folder(const char *);
extern "C" void tio_free_apple_string(char *);
extern "C" void tio_reset_folder_locks();
extern "C" void tio_register_folder(char *(*)(const char *), void (*)(char *), void (*)());

extern "C" void tio_register_background();
extern "C" void tio_register_foreground();
extern "C" bool tio_is_active();
extern "C" void tio_set_foreground_reader(bool (*)(void));

int main(int argc, char * argv[]) {
    tio_register_background();
    tio_register_foreground();
    tio_set_foreground_reader(tio_is_active);
	tio_register_folder(tio_apple_folder, tio_free_apple_string, tio_reset_folder_locks);
    ffi::start_app();
	return 0;
}
