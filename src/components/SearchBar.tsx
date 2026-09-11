import { Search, X } from 'lucide-react';
import { forwardRef } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  ({ value, onChange, className, placeholder = 'Search accounts...' }, ref) => {
    return (
      <div className={`relative ${className}`}>
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={16} />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="peer w-full border-0 bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm ps-9 pe-9 py-2 outline-none"
        />
        {/* The only focus indicator there is, which is why it is 2px of the
            app's accent and not a hairline: the field has no border and no fill
            to change, and `outline-none` was already here.

            One transition on scaleX does both directions. Focus takes it to
            full width from the leading edge; losing focus transitions the same
            property back to 0 and it retracts the way it came, because that is
            what a transition is — an @keyframes pair would have needed a
            second animation, and a state to remember which one to play.

            `origin-left` flips to `origin-right` under RTL: the leading edge is
            the one the caret starts at, not the one on the left. Sibling of the
            input rather than a ::after on it, because a replaced element like
            an input has no pseudo-elements to give.

            Motion off, the transition duration goes to zero and the line still
            appears — the end state is not the animation. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left rtl:origin-right scale-x-0 rounded-full bg-[#4285F4] transition-transform duration-300 ease-out peer-focus:scale-x-100"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
    );
  }
);
