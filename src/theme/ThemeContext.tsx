import React, { createContext, useContext, useState, useEffect } from 'react';

export type KaliTheme = 'kali-dark' | 'white-terminal';

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
    tag: 'DARK',
    primaryColor: '#00F0FF',
    bgPreview: '#0A0B0D',
    borderPreview: '#1A1B1F',
    accentPreview: '#00F0FF',
  },
  {
    id: 'white-terminal',
    nameKey: 'themeWhiteTerminal',
    defaultName: 'Clean White Workstation',
    tag: 'LIGHT',
    primaryColor: '#0284C7',
    bgPreview: '#F8FAFC',
    borderPreview: '#E2E8F0',
    accentPreview: '#0284C7',
  },
];

interface ThemeContextType {
  theme: KaliTheme;
  isLight: boolean;
  setTheme: (theme: KaliTheme) => void;
  toggleTheme: () => void;
  themeOptions: ThemeOption[];
  currentThemeOption: ThemeOption;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'kali_recorder_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<KaliTheme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'white-terminal' || saved === 'kali-dark') {
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

  const toggleTheme = () => {
    setTheme(theme === 'kali-dark' ? 'white-terminal' : 'kali-dark');
  };

  // Sync data-theme attribute and classes on document.documentElement and body
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      if (theme === 'white-terminal') {
        document.documentElement.classList.add('theme-light');
        document.documentElement.classList.remove('theme-dark');
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
      } else {
        document.documentElement.classList.add('theme-dark');
        document.documentElement.classList.remove('theme-light');
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
      }
    }
  }, [theme]);

  const isLight = theme === 'white-terminal';
  const currentThemeOption =
    THEME_OPTIONS.find((t) => t.id === theme) || THEME_OPTIONS[0];

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isLight,
        setTheme,
        toggleTheme,
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
