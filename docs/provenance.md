# Engine provenance

mosAIc extracts and extends the mosaic renderer developed in the [sketches repository](https://github.com/Audiofool934/sketches).
Project-authored code is distributed under the [MIT License](../LICENSE), with incorporated implementations recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Source lineage

The first substantive stone renderer and contour-following tessellator appeared in `piece/odyssey-lantern` at commit `e8f1792a5ed3cb15a4f4f6d9bc5a49aeaf722e4f`.
Commit `2ee124dea514664389c7334470967879b0ee4536` expanded its stone rendering, lighting, depth of field, and export workflow.
The `piece/the-road-home` snapshot at `be7fb47` separated the shared implementation into `engine/` and `tools/` modules.
That snapshot is this project's extraction baseline.
The source artwork, story-specific picture modules, and films are not part of the reusable engine extraction.

## Attributed implementations

The shader retains Benjamin Wrensch's Minimal AgX polynomial and matrices under MIT, with this renderer's custom look parameters and output handling.
David Hoskins's scalar shader hash is recorded through David A Roberts's explicitly MIT-licensed WGSL port, with both notices preserved.
The seeded JavaScript generator follows Tommy Ettinger's CC0 Mulberry32 algorithm.
Their sources and full required notices are in `THIRD_PARTY_NOTICES.md`.

The inherited distance-transform helper named Felzenszwalb but did not record whether its implementation came from the published algorithm or the authors' separately licensed reference code.
mosAIc replaces that helper with an adaptation of Mapbox TinySDF's BSD-2-Clause implementation, pinned to revision `45865e7f2d7613ebcb95ad459993b7e78febfa3f`.
This establishes a recorded permissive source for the implementation.
The adaptation retains nearest-source indices, lowest-x then lowest-y tie resolution, empty-mask behavior, and the existing typed-array interface.
The legacy helper is not included as a test dependency or fixture.

The lattice-noise helper evaluates cubic interpolation of four corner values and its analytical derivatives directly.
Its implementation is expressed from that calculation rather than carrying forward an unattributed shader snippet.

## Algorithm references

The distance transform uses the method described in [Distance Transforms of Sampled Functions](https://cs.brown.edu/people/pfelzens/dt/) by Pedro Felzenszwalb and Daniel Huttenlocher.
The contour-following stone layout uses an andamento field and evenly spaced streamlines, following the ideas of Bruno Jobard and Wilfrid Lefer.
The renderer also uses standard perspective matrices, low-discrepancy sampling, microfacet lighting, and cubic interpolation.
These technique references describe mathematical lineage, not additional vendored libraries.

## Verification

`tests/distance.test.mjs` compares the replacement distance transform with an independent exhaustive nearest-source search.
It covers every 4 by 3 binary mask, sparse and dense rectangular masks, exact ties, empty masks, singleton inputs, full masks, and one-dimensional inputs.
Three additional output fingerprints were captured from the extraction baseline before replacement and confirm identical distances and nearest-source choices for larger deterministic fixtures.
The tests encode those fingerprints explicitly in little-endian order for portable comparison.

Rendered appearance remains a separate verification step because shader arithmetic and browser graphics implementations can differ slightly in rounding.
Source inspection and numerical tests do not establish cross-browser visual equivalence.

## Distribution boundary

Keep `LICENSE` and `THIRD_PARTY_NOTICES.md` with generated distributions that contain these implementations.
An image or sound imported by a user retains its own rights and permissions.
Examples distributed with this project must have a recorded source and permission compatible with their intended use.
No trailer footage, external recordings, franchise-themed source artwork, or third-party font files are included by the engine extraction.
