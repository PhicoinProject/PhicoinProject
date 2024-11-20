#include <cstdint> 
class pcg32
{
    uint64_t state;
    uint64_t inc;

public:
    pcg32(uint64_t initstate, uint64_t initseq) : state(initstate), inc(initseq) {}

    uint32_t operator()()
    {
        uint64_t oldstate = state;
        state = oldstate * 6364136223846793005ULL + (inc | 1); 
        uint32_t xorshifted = static_cast<uint32_t>(((oldstate >> 18u) ^ oldstate) >> 27u);
        uint32_t rot = static_cast<uint32_t>(oldstate >> 59u);
        return (xorshifted >> rot) | (xorshifted << ((32 - rot) & 31));
    }
};