// Every translation, imported statically for the service worker.
//
// The popup loads one language on demand with a dynamic import, but Chrome
// refuses `import()` in a service worker, so there the table has to be part of
// the bundle. The chunks are the same ones the pages load; only the worker pays
// for parsing all of them, and only for the few quick-fill strings it shows.

import type { Language, TranslationStrings } from '@/utils/i18n';
import ar from '@/utils/locales/ar';
import de from '@/utils/locales/de';
import en from '@/utils/locales/en';
import es from '@/utils/locales/es';
import fr from '@/utils/locales/fr';
import hi from '@/utils/locales/hi';
import id from '@/utils/locales/id';
import it from '@/utils/locales/it';
import ja from '@/utils/locales/ja';
import ko from '@/utils/locales/ko';
import nl from '@/utils/locales/nl';
import pl from '@/utils/locales/pl';
import pt from '@/utils/locales/pt';
import ru from '@/utils/locales/ru';
import sv from '@/utils/locales/sv';
import th from '@/utils/locales/th';
import tr from '@/utils/locales/tr';
import uk from '@/utils/locales/uk';
import vi from '@/utils/locales/vi';
import zh from '@/utils/locales/zh';

export const LANGUAGE_TABLES: Record<Language, TranslationStrings> = {
  ar, de, en, es, fr, hi, id, it, ja, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh,
};
