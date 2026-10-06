# Sound

The stones are heard like a small pouch of stones poured onto a table.
A sliding pointer sets off stones near its path, and each one is heard as its own material landing on something solid.
Each material's voice is derived from published measurements of that material, not tuned by ear.
Only a few style settings, shared by every material, are tuned by ear, once, for the whole set.

## How a stone is heard

`engine/contact.js` sets off about seventy stones for each width of the view the pointer covers, at most sixty a second, the first as soon as it moves, and only where there are stones.
Each contact carries the material and size of its stone, a strength that grows with the pointer's speed, and when and where it is heard.

`engine/sound.js` renders each stone as a small square tile with free edges landing on a table.
The tile has four modes, at 1, 1.456, 1.803 and 2.584 times its lowest, the first modes of a completely free square plate [11].
A soft fall sets mostly the lowest mode ringing, so the higher ones are excited less and less.
Under the tile, the table gives its own low knock, and a moment of grit marks the contact.
Every stone is given the same energy, so no material is louder than another.

## From measurements to sound

Three measured properties of a material set its voice, each relative to glass.

- The speed of sound in it, c, sets its pitch, because a tile's modes rise in proportion to it: pitch = PITCH × c / c(glass).
- Its loss factor, η, sets how long it rings, because a mode of frequency f rings for 1 / (π f η) seconds: a tile of it rings (η(glass) c(glass)) / (η c) times as long as one of glass.
- Its density, ρ, sets how hard it knocks the table, because a heavier stone lands harder: thud = √(ρ / ρ(glass)).

A smaller stone sounds higher, as its modes are: its pitch follows the square root of 10 mm over its size, within a quarter either way.

## The style

These settings are the same for every material, and they are the only ones tuned by ear.

| Setting | Value | Meaning |
| --- | --- | --- |
| REFERENCE | 10 mm | The stone size the voices are given for |
| PITCH | 1000 Hz | The lowest mode of a glass stone of that size |
| RING | 18 ms | How long that mode rings |
| KEEP | 0.6 | How much of the measured difference in ringing is kept, so metal rings on without drowning the stones |
| MODES | 1, 0.4, 0.25, 0.12 | How strongly a soft fall excites each mode |
| LEVEL | 0.28 | How loud a stone is at full strength |

Every voice is rounded off above 3 kHz and the whole mix above 4.5 kHz, and everything below 150 Hz is cut.

The measurements cannot be used literally.
A real tessera is so small that its own modes ring far above hearing, so a literal model gives brief, high clicks, like the rock presets of Cook's shaker model at 6.5 to 9 kHz [7].
The engine therefore keeps the differences between materials and moves the whole set, together, into a comfortable range.
If the set as a whole needs to change, change these settings and never a single material.

## Materials

| Material | Speed of sound (m/s) | Density (kg/m³) | Loss factor | Sources and notes |
| --- | --- | --- | --- | --- |
| Glass | 4900 | 2500 | 1.1 × 10⁻³ | Cremer and Heckl [4]: 4900 m/s, 2.5 g/cm³, loss factor 0.6 to 2 × 10⁻³, of which this is the geometric middle. |
| Gold | 2000 | 19300 | 3 × 10⁻⁴ | Cremer and Heckl [4], longitudinal loss factor. |
| Silver | 2700 | 10500 | 4 × 10⁻⁴ | Cremer and Heckl [4], longitudinal loss factor; flexural is given only as below 3 × 10⁻³. |
| Marble | 4900 | 2700 | 3.3 × 10⁻³ | Speed from a Young's modulus of 65 GPa (50 to 70 in [5], 60 to 90 in [6]) and a density of 2700 (2480 to 2760). No measured damping of intact marble was found, so granite's Q of about 300 stands in [8]. |
| Basalt | 4550 | 2900 | 1.8 × 10⁻³ | Speed from a Young's modulus of 60 GPa (20 to 100 in [6]) and a density of 2900 (3000 in [6]). Q of about 550 at 3 to 4 kHz [8]. |
| Limestone | 3350 | 2650 | 1 × 10⁻² | Speed from a Young's modulus of 30 GPa (15 to 55 in [5], 10 to 80 in [6]) and a density of 2650. Measured Q runs from 50 to 650 between limestones [8]; the page's limestone is pitted and porous, so Q = 100. |
| Terracotta | 2750 | 2000 | 1.4 × 10⁻² | Fired clay, as brick in Cremer and Heckl [4]: 2500 to 3000 m/s, 1.9 to 2.2 g/cm³, loss factor 1 to 2 × 10⁻². |
| Light | | | | Glass that glows, so it sounds as glass. |

The figures for metal, glass and brick come from one standard reference and are the most reliable.
Natural stone varies widely from sample to sample: one laboratory study measured granite at a Q of only about 14 at ultrasonic frequencies [9].
The Q values for granite, basalt and limestone come from a rock attenuation table on the SEG wiki, which blocks automated access, so they were read only through search summaries and should be checked by hand [8].
Treat the stone figures as typical values, and replace them when a better measurement turns up.

## Adding a material

1. Find, in a published source, the speed of sound in it (or its Young's modulus E and density ρ, from which c = √(E / ρ)), its density, and its loss factor (or its quality factor Q, from which η = 1 / Q).
2. Add a row to `MEASURED` in `engine/sound.js` and to the table above, with the source.
3. If it only looks different from a material that is already there, as light is glass, map it in `LIKE` instead.
4. Listen to it among the others, and compare it with real recordings of that material: the order of pitch and of ringing should match.
5. If it sounds wrong, check the measurement first; only if the whole set sounds wrong, change the style.

## Checking against recordings

Real recordings make the comparison concrete.
RealImpact has 150,000 recordings of impacts on 50 real objects, with their materials and contact forces [12].
Greatest Hits has nearly a thousand videos of a drumstick hitting and scratching real materials [13].
For a material, measure how long its strongest mode takes to die away and where its spectrum is centred, and compare the ratios between materials with those of the engine's voices.

## The research behind it

How fast a sound decays is the strongest cue listeners use to tell materials apart [1].
Listeners reliably tell metal and glass from wood and plastic, and within those groups go mostly by pitch and apparent size [2].
A synthesiser can be steered through a space of materials by damping and spectral content [3].
Cook's physically informed stochastic model is the standard way to make many small objects shaken or poured [7].
Modal synthesis of impacts, scraping and rolling in real time, for games, is described by van den Doel, Kry and Pai [10].

## Sources

1. R. L. Klatzky, D. K. Pai and E. P. Krotkov, [Perception of material from contact sounds](https://www.cs.ubc.ca/labs/lci/papers/docs2000/pai-KlaPai00.pdf), Presence 9(4), 2000.
2. B. L. Giordano and S. McAdams, [Material identification of real impact sounds: effects of size variation in steel, glass, wood, and plexiglass plates](https://eprints.gla.ac.uk/68504), Journal of the Acoustical Society of America 119(2), 2006.
3. M. Aramaki, M. Besson, R. Kronland-Martinet and S. Ystad, [Controlling the perceived material in an impact sound synthesizer](https://hal.archives-ouvertes.fr/hal-00465085), IEEE Transactions on Audio, Speech, and Language Processing 19(2), 2011.
4. L. Cremer and M. Heckl, Structure-Borne Sound, Springer, 1988, Tables 1, 2 and 7 as reproduced in T. Irvine, [Damping Properties of Materials, Revision D](http://vibrationdata.com/tutorials_alt/damping.pdf), 2010.
5. IRCAM, [Modalys material properties](https://support.ircam.fr/docs/Modalys/3.4.1/co/object_properties_material.html).
6. Engineers Edge, [Rock engineering properties](https://www.engineersedge.com/civil_engineering/rock_engineering_properties_16321.htm), after the Dyno Nobel Blasting and Explosives Quick Reference Guide, 2010.
7. P. R. Cook, Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds, Computer Music Journal 21(3), 1997, and its presets in the [Synthesis ToolKit](https://github.com/thestk/stk/blob/master/src/Shakers.cpp).
8. SEG wiki, [Inverse Q filtering](https://wiki.seg.org/wiki/Inverse_Q_filtering), table of intrinsic attenuation in rocks, read through search summaries only.
9. W. A. M. Wanniarachchi et al., [Assessment of dynamic material properties of intact rocks using seismic wave attenuation](https://pmc.ncbi.nlm.nih.gov/articles/PMC5666273/), Royal Society Open Science 4, 2017.
10. K. van den Doel, P. G. Kry and D. K. Pai, [FoleyAutomatic: physically-based sound effects for interactive simulation and animation](https://www.cs.mcgill.ca/~kry/pubs/foleyautomatic/foleyautomatic.pdf), SIGGRAPH 2001.
11. N. Apaipong and Y. Sompornjaroensuk, [On the free-vibration frequencies of square plates with different edge conditions](https://ph02.tci-thaijo.org/index.php/ET/article/view/244598), Engineering Transactions 18(1), 2015, Table A1, case F-F-F-F.
12. S. Clarke et al., [RealImpact: a dataset of impact sound fields for real objects](https://arxiv.org/abs/2306.09944), CVPR 2023.
13. A. Owens et al., [Visually indicated sounds](https://arxiv.org/abs/1512.08512), CVPR 2016.
