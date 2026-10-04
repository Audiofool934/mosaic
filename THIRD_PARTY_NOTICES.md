# Third-party notices

mosAIc's own code is licensed under the [MIT License](LICENSE).
The components listed below retain their stated terms.
Include this file with source distributions, generated browser distributions, and other copies containing these components.

## Minimal AgX

Used in `engine/renderer.js`, in the `agxContrast` and `agx` shader functions.
The implementation is adapted from Benjamin Wrensch's [Minimal AgX implementation](https://iolite-engine.com/blog_posts/minimal_agx_implementation).
The original source and license were checked on 2026-10-04.
Our adaptation combines the stages, guards the logarithm and power operations, uses custom look parameters, and adjusts output handling for this renderer.
Wrensch credits the values in [Troy Sobotka's original AgX configuration](https://github.com/sobotka/AgX).
No AgX LUT files or OCIO configuration files are distributed here.

```text
MIT License

Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Hash without Sine

Used in `engine/renderer.js`, in the `hash12` shader function.
The algorithm is David Hoskins's [Hash without Sine](https://www.shadertoy.com/view/4djSRW).
The GLSL helper is re-expressed from the explicitly licensed [WGSL port by David A Roberts](https://gist.github.com/davidar/5f9677a0ccfbd63d7a8657ad9af3a856/f3619046080c1f8ff07c54f6658ed215ef5f9638), retaining both notices below.
The checked gist revision is `f3619046080c1f8ff07c54f6658ed215ef5f9638`.
The port and its license were checked on 2026-10-04.

```text
MIT License

Copyright (c) 2014 David Hoskins.
Copyright (c) 2022 David A Roberts <https://davidar.io/> (WGSL port)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## TinySDF distance transform

Used in `engine/util.js`, in the `distanceLine` helper called by `edt`.
The lower-envelope implementation is adapted from [Mapbox TinySDF](https://github.com/mapbox/tiny-sdf/blob/45865e7f2d7613ebcb95ad459993b7e78febfa3f/index.js), revision `45865e7f2d7613ebcb95ad459993b7e78febfa3f`.
The upstream [license](https://github.com/mapbox/tiny-sdf/blob/45865e7f2d7613ebcb95ad459993b7e78febfa3f/LICENSE.txt) is BSD-2-Clause.
Our adaptation accepts separate work arrays, skips absent source sites, returns nearest-source coordinates, and preserves the renderer's behavior for ties and empty masks.
TinySDF documents that its implementation was based on the Felzenszwalb/Huttenlocher paper rather than the authors' C++ reference implementation.

```text
BSD-2-Clause
Copyright (c) 2016-2024 Mapbox, Inc.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Mulberry32

Used in `engine/util.js`, in the `rng` function.
The generator follows [Tommy Ettinger's original Mulberry32 implementation](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c/fc93b8ad259c09a3635d80ed12a05309120795dc), written in 2017.
The checked gist revision is `fc93b8ad259c09a3635d80ed12a05309120795dc`.
The implementation was dedicated to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
This JavaScript expression uses `Math.imul`, unsigned shifts, and division by 2^32 to return values in `[0, 1)`.
The upstream dedication reads:

```text
Written in 2017 by Tommy Ettinger (tommy.ettinger@gmail.com)

To the extent possible under law, the author has dedicated all copyright and related and neighboring rights to this software to the public domain worldwide.
This software is distributed without any warranty.

See <http://creativecommons.org/publicdomain/zero/1.0/>.
```

## Separately installed tools

The development dependency `playwright-core` is distributed by Microsoft under [Apache License 2.0](https://github.com/microsoft/playwright/blob/main/LICENSE).
Its package carries its own license and notices.
FFmpeg and Chromium or Chrome are separately installed tools, not vendored source or binaries in this repository.
If a downstream distributor bundles any of those packages or binaries, retain their supplied licenses and satisfy the terms for the particular build being distributed.

Imported images and sound recordings keep their own rights and permissions.
The project's code license does not grant rights to those inputs.
