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

`tmoney/TmoneyRoundWindRegular.otf`, 3.0 MB, from
<https://www.tmoney.co.kr/aeb/cmnctn/ci/ci.dev>, byte-for-byte as Tmoney
distributes it in `TmoneyRoundWind.zip` (`02_수동설치파일/01_otf/`).

**Unmodified on purpose.** The licence is free for any use, commercial
included, but forbids selling the font and forbids redistributing a modified
or adapted copy — it has to travel in the form it was distributed in. So no
subsetting to the 2,350 common syllables, and no WOFF2 conversion, either of
which would have taken this file under a megabyte. The 3.0 MB is the price of
staying inside the licence.

The OTF, not the TTF: same font, 3.0 MB against 4.4 MB, and both are shipped
by Tmoney in that zip.

Regular only. ExtraBold is the only other weight offered, this interface's
heaviest is `font-semibold`, and an extra-bold face standing in for a
semi-bold one is worse than the browser synthesising the difference — and
worse by another 3.0 MB.

Its digits are already tabular: every one of `0`–`9` is 640 units wide, so a
code does not shift as it changes. That is the reason it can carry the codes
and not only the Korean.

`local()` comes before `url()` in every `@font-face` for this family, so a
machine with the font installed never reads the bundled copy.
