#include "bindings/bindings.h"
#include <stddef.h>
#include <stdint.h>

extern "C" char *tio_apple_folder(const char *);
extern "C" void tio_free_apple_string(char *);
extern "C" void tio_reset_folder_locks(const char *);
extern "C" void tio_register_folder(char *(*)(const char *), void (*)(char *), void (*)(const char *));

using ReleaseReply = void (*)(void *, int32_t, const char *, const uint8_t *, size_t);
using ReleaseGet = void (*)(const char *, const char *, size_t, uint32_t, void *, ReleaseReply);
using ReleaseVerify = bool (*)(const uint8_t *, const uint8_t *, const uint8_t *, size_t);
extern "C" void tio_ios_update_get(const char *, const char *, size_t, uint32_t, void *, ReleaseReply);
extern "C" bool tio_ios_verify_update(const uint8_t *, const uint8_t *, const uint8_t *, size_t);
extern "C" void tio_register_update_http(ReleaseGet);
extern "C" void tio_register_update_verifier(ReleaseVerify);

extern "C" void tio_register_background();
extern "C" void tio_register_foreground();
extern "C" bool tio_is_active();
extern "C" void tio_set_foreground_reader(bool (*)(void));
extern "C" void tio_show_startup(void *);
extern "C" void tio_finish_startup(void *, bool, int32_t);
extern "C" void tio_register_startup(void (*)(void *), void (*)(void *, bool, int32_t));

extern "C" bool tio_supports_ipad_windows();
extern "C" bool tio_focus_scene(const char *);
extern "C" void tio_request_scene(const char *, const char *);
extern "C" char *tio_requested_scene_label(const void *);
extern "C" bool tio_close_scene(const char *, const char *);
extern "C" void tio_register_scenes(bool (*)(), bool (*)(const char *), void (*)(const char *, const char *), char *(*)(const void *), void (*)(char *), bool (*)(const char *, const char *));

int main(int argc, char * argv[]) {
    tio_register_background();
    tio_register_foreground();
    tio_set_foreground_reader(tio_is_active);
    tio_register_startup(tio_show_startup, tio_finish_startup);
	tio_register_folder(tio_apple_folder, tio_free_apple_string, tio_reset_folder_locks);
    tio_register_scenes(tio_supports_ipad_windows, tio_focus_scene, tio_request_scene, tio_requested_scene_label, tio_free_apple_string, tio_close_scene);
    tio_register_update_http(tio_ios_update_get);
    tio_register_update_verifier(tio_ios_verify_update);
    ffi::start_app();
	return 0;
}
