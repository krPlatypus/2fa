# Bundled fonts

Two faces ship with the extension. Neither is fetched over the network — the
popup still makes no request to render, which is the claim the rest of this
project is built around.

## Ubuntu — Latin and Cyrillic

`ubuntu/*.woff2`, from Google Fonts, are the `latin`, `latin-ext` and
`cyrillic` subsets at weights 400, 500 and 700. Nine files, 118 KB together.

Not the Nerd Font patch: that adds some 3,600 icon glyphs and several
megabytes, and every icon in this interface is an SVG from lucide-react. There
is nothing here for those glyphs to draw.

Greek and `cyrillic-ext` are left out — no interface string reaches them.
Arabic, Hindi, Thai, Japanese, Chinese and Vietnamese diacritics are outside
what Ubuntu covers at all, and fall through to the platform font.

Licence: Ubuntu Font Licence 1.0, in `ubuntu/UFL.txt`. Use, modification and
redistribution are permitted; subsetting is why the files above are small.

## 티머니 둥근바람 — Korean, and the codes

Not bundled. `src` in globals.css lists three `local()` names and no `url()`,
so the face is used where the machine already has it installed and ignored
everywhere else. Korean then falls through to the platform font, which is what
this app used before any font was chosen at all.

It did ship here once, 3.0 MB of it. The licence is free for any use,
commercial included, but forbids redistributing a modified or adapted copy — so
no subsetting to the 2,350 common syllables and no WOFF2 conversion, either of
which would have taken it under a megabyte. Shipping it unmodified was the only
way to ship it, and 3.0 MB is a lot beside the 430 KB the rest of the popup
weighs. The cost was never the bytes, which come off local disk through
`chrome-extension://`; it was the twelve thousand glyphs Chrome parses into a
typeface before the first frame, and on the first open after a browser start it
showed.

Referencing an installed font is not redistribution, so the licence question
goes away with the file.

**To get it back on a machine:** download `TmoneyRoundWind.zip` from
<https://www.tmoney.co.kr/aeb/cmnctn/ci/ci.dev> and install
`02_수동설치파일/01_otf/TmoneyRoundWindRegular.otf`. Nothing in the extension
needs changing — the `local()` names find it.

Its digits are tabular, every one of `0`-`9` 640 units wide, so a code does not
shift as it changes. That is why it carries the codes and not only the Korean,
and why the `font-otp` stack falls back to monospace rather than to the UI
font: the property has to survive the face being absent.
