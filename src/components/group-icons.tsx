import {
  Briefcase,
  Building2,
  Cloud,
  Code2,
  CreditCard,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Key,
  Landmark,
  Laptop,
  Lock,
  Mail,
  Plane,
  Server,
  Shield,
  ShoppingCart,
  Smartphone,
  Star,
  User,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * The icons a group can be given.
 *
 * A fixed list of twenty-four, imported by name. lucide ships 4,226 exports
 * and reaching them dynamically — `icons[name]` off a namespace import — pulls
 * every one of them into the bundle, because nothing can be shaken out of an
 * object that is indexed at runtime. It would also be a hopeless picker: a
 * group is Work, Personal, Backup or Family, and a shape for each of those is
 * a short list, not a search.
 *
 * Uploads are not offered here, unlike accounts. A group is a category the
 * user invented rather than a service with a logo, and a generic shape says
 * what it needs to. It also keeps the choice a name instead of an image, which
 * is what makes a group icon cost nothing to store.
 *
 * Names are stored, not indexes. An index would silently point at a different
 * icon the moment this list is reordered.
 */
export const GROUP_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'briefcase', Icon: Briefcase },
  { name: 'user', Icon: User },
  { name: 'users', Icon: Users },
  { name: 'home', Icon: Home },
  { name: 'building', Icon: Building2 },
  { name: 'shield', Icon: Shield },
  { name: 'lock', Icon: Lock },
  { name: 'key', Icon: Key },
  { name: 'wallet', Icon: Wallet },
  { name: 'card', Icon: CreditCard },
  { name: 'bank', Icon: Landmark },
  { name: 'cart', Icon: ShoppingCart },
  { name: 'cloud', Icon: Cloud },
  { name: 'server', Icon: Server },
  { name: 'code', Icon: Code2 },
  { name: 'laptop', Icon: Laptop },
  { name: 'phone', Icon: Smartphone },
  { name: 'mail', Icon: Mail },
  { name: 'game', Icon: Gamepad2 },
  { name: 'school', Icon: GraduationCap },
  { name: 'plane', Icon: Plane },
  { name: 'tool', Icon: Wrench },
  { name: 'star', Icon: Star },
  { name: 'heart', Icon: Heart },
];

const BY_NAME = new Map(GROUP_ICONS.map(entry => [entry.name, entry.Icon]));

/**
 * The component for a stored name, or null.
 *
 * Null for a name this build does not have, which is what a group icon set on
 * a newer version and synced back looks like. The chip then draws as it always
 * did rather than as a gap.
 */
export function groupIcon(name: string | undefined): LucideIcon | null {
  return (name && BY_NAME.get(name)) || null;
}
