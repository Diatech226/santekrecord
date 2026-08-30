import React, { createContext, useContext, useState, useEffect } from 'react';

export type KaliTheme = 'kali-dark' | 'terminal-green' | 'kali-blue' | 'white-terminal';

export interface ThemeOption {
  id: KaliTheme;
  nameKey: string;
  defaultName: string;
  tag: string;
  primaryColor: string;
  bgPreview: string;
  borderPreview: string;
  accentPreview: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'kali-dark',
    nameKey: 'themeKaliDark',
    defaultName: 'Kali Stealth Dark',
    tag: 'CYAN',
    primaryColor: '#00F0FF',
    bgPreview: '#0A0B0D',
    borderPreview: '#1A1B1F',
    accentPreview: '#00F0FF',
  },
  {
    id: 'terminal-green',
    nameKey: 'themeTerminalGreen',
    defaultName: 'Terminal Green',
    tag: 'PHOSPHOR',
    primaryColor: '#00FF66',
    bgPreview: '#050B06',
    borderPreview: '#15301B',
    accentPreview: '#00FF66',
  },
  {
    id: 'kali-blue',
    nameKey: 'themeKaliBlue',
    defaultName: 'Kali Dragon Blue',
    tag: 'COBALT',
    primaryColor: '#388BFD',
    bgPreview: '#060A14',
    borderPreview: '#172A52',
    accentPreview: '#388BFD',
  },
  {
    id: 'white-terminal',
    nameKey: 'themeWhiteTerminal',
    defaultName: 'White Terminal',
    tag: 'LIGHT',
    primaryColor: '#0088AA',
    bgPreview: '#F3F4F6',
    borderPreview: '#D1D5DB',
    accentPreview: '#0088AA',
  },
];

interface ThemeContextType {
  theme: KaliTheme;
  setTheme: (theme: KaliTheme) => void;
  themeOptions: ThemeOption[];
  currentThemeOption: ThemeOption;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'kali_recorder_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<KaliTheme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (
        saved === 'kali-dark' ||
        saved === 'terminal-green' ||
        saved === 'kali-blue' ||
        saved === 'white-terminal'
      ) {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'kali-dark';
  });

  const setTheme = (newTheme: KaliTheme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }
  };

  // Sync data-theme attribute on document.documentElement
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      if (theme === 'white-terminal') {
        document.documentElement.classList.add('theme-light');
        document.documentElement.classList.remove('theme-dark');
      } else {
        document.documentElement.classList.add('theme-dark');
        document.documentElement.classList.remove('theme-light');
      }
    }
  }, [theme]);

  const currentThemeOption =
    THEME_OPTIONS.find((t) => t.id === theme) || THEME_OPTIONS[0];

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        themeOptions: THEME_OPTIONS,
        currentThemeOption,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
