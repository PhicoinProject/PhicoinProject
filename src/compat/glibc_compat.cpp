#if defined(HAVE_CONFIG_H)
#include "config/phicoin-config.h"
#endif
#include <cstddef>
#include <cstdint>
#if defined(HAVE_SYS_SELECT_H)
#include <sys/select.h>
#endif
extern "C" void* memmove(void* a, const void* b, size_t c);
extern "C" void* memcpy(void* a, const void* b, size_t c) { return memmove(a, b, c); }
extern "C" void __chk_fail(void) __attribute__((__noreturn__));
extern "C" FDELT_TYPE __fdelt_warn(FDELT_TYPE a) { if (a >= FD_SETSIZE) __chk_fail(); return a / __NFDBITS; }
extern "C" FDELT_TYPE __fdelt_chk(FDELT_TYPE) __attribute__((weak, alias("__fdelt_warn")));
#if defined(__i386__) || defined(__arm__)
extern "C" int64_t __udivmoddi4(uint64_t u, uint64_t v, uint64_t* rp);
extern "C" int64_t __wrap___divmoddi4(int64_t u, int64_t v, int64_t* rp) {
    int32_t c1 = 0, c2 = 0; int64_t uu = u, vv = v, w, r;
    if (uu < 0) { c1 = ~c1, c2 = ~c2, uu = -uu; }
    if (vv < 0) { c1 = ~c1, vv = -vv; }
    w = __udivmoddi4(uu, vv, (uint64_t*)&r);
    if (c1) w = -w; if (c2) r = -r;
    *rp = r; return w;
}
#endif
