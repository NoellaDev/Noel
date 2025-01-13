import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    PopoverPortal,
} from "@radix-ui/react-popover";
import React, { useEffect, useState } from 'react';
import { FaMoon, FaSun } from 'react-icons/fa';
import VertDots from './ui/VertDots';
import { useNavigate, useLocation } from 'react-router-dom';

interface VersionInfo {
    current_version: string;
    available_versions: string[];
}

export default function MoreMenu() {
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [versions, setVersions] = useState<VersionInfo | null>(null);
    const [showVersions, setShowVersions] = useState(false);
    const [useSystemTheme, setUseSystemTheme] = useState(() =>
        localStorage.getItem('use_system_theme') === 'true'
    );
    const [isDarkMode, setDarkMode] = useState(() => {
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        return useSystemTheme 
            ? systemPrefersDark 
            : localStorage.getItem('theme') === 'dark';
    });

    // Fetch versions when menu opens
    useEffect(() => {
        const fetchVersions = async () => {
            try {
                const port = window.appConfig.get("GOOSE_SERVER__PORT");
                const response = await fetch(`http://127.0.0.1:${port}/api/agent/versions`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                setVersions(data);
            } catch (error) {
                console.error('Failed to fetch versions:', error);
            }
        };
        
        if (open) {
            fetchVersions();
        }
    }, [open]);

    // Theme effects
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleThemeChange = (e: MediaQueryListEvent) => {
            if (useSystemTheme) {
                setDarkMode(e.matches);
            }
        };
        mediaQuery.addEventListener('change', handleThemeChange);
        return () => mediaQuery.removeEventListener('change', handleThemeChange);
    }, [useSystemTheme]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode);
        if (!useSystemTheme) {
            localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
        }
    }, [isDarkMode, useSystemTheme]);

    // Close menu on navigation
    useEffect(() => {
        setOpen(false);
    }, [location.pathname]);

    const handleVersionSelect = (version: string) => {
        setOpen(false);
        setShowVersions(false);
        window.electron.createChatWindow(undefined, undefined, version);
    };

    const toggleTheme = () => {
        if (!useSystemTheme) {
            setDarkMode(!isDarkMode);
        }
    };

    const toggleUseSystemTheme = (event: React.ChangeEvent<HTMLInputElement>) => {
        const checked = event.target.checked;
        setUseSystemTheme(checked);
        localStorage.setItem('use_system_theme', checked.toString());
        
        if (checked) {
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            setDarkMode(systemPrefersDark);
            localStorage.removeItem('theme');
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button className="z-[100] absolute top-[-4px] right-[10px] w-[20px] h-[20px] cursor-pointer no-drag">
                    <VertDots size={18}/>
                </button>
            </PopoverTrigger>
            <PopoverPortal>
                <PopoverContent 
                    className="z-[200] w-48 rounded-md bg-black text-white dark:bg-gray-800 shadow-lg" 
                    align="end"
                    sideOffset={5}
                >
                    <div className="flex flex-col rounded-md">
                        <div className="flex items-center justify-between p-2">
                            <span className="text-sm">Use System Theme</span>
                            <input
                                type="checkbox"
                                checked={useSystemTheme}
                                onChange={toggleUseSystemTheme}
                            />
                        </div>
                        {!useSystemTheme && (
                            <div className="flex items-center justify-between p-2">
                                <span className="text-sm">{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                                <button
                                    className={`relative inline-flex items-center h-6 rounded-full w-11 focus:outline-none border-2 ${
                                        isDarkMode ? 'bg-gray-600 border-gray-600' : 'bg-yellow-300 border-yellow-300'
                                    }`}
                                    onClick={toggleTheme}
                                >
                                    <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${
                                        isDarkMode ? 'translate-x-6' : 'translate-x-1'
                                    }`}>
                                        {isDarkMode ? <FaMoon className="text-gray-200"/> : <FaSun className="text-yellow-500"/>}
                                    </span>
                                </button>
                            </div>
                        )}

                        {versions && versions.available_versions.length > 0 && (
                            <>
                                <button
                                    onClick={() => setShowVersions(!showVersions)}
                                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-700 flex justify-between items-center"
                                >
                                    <span>Versions</span>
                                    <span className="text-xs">{showVersions ? '▼' : '▶'}</span>
                                </button>
                                {showVersions && (
                                    <div className="pl-2 bg-gray-900">
                                        {versions.available_versions.map((version) => (
                                            <button
                                                key={version}
                                                onClick={() => handleVersionSelect(version)}
                                                className={`w-full text-left px-2 py-1.5 text-sm hover:bg-gray-700 ${
                                                    version === versions.current_version ? 'text-green-400' : ''
                                                }`}
                                            >
                                                {version} {version === versions.current_version && '(current)'}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {process.env.NODE_ENV === 'development' && (
                            <button
                                onClick={() => {
                                    setOpen(false);
                                    navigate('/settings');
                                }}
                                className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-700"
                            >
                                Settings
                            </button>
                        )}

                        <button
                            onClick={() => {
                                setOpen(false);
                                window.electron.directoryChooser();
                            }}
                            className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-700"
                        >
                            Open Directory (cmd+O)
                        </button>
                        <button
                            onClick={() => {
                                setOpen(false);
                                window.electron.createChatWindow();
                            }}
                            className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-700"
                        >
                            New Session (cmd+N)
                        </button>
                    </div>
                </PopoverContent>
            </PopoverPortal>
        </Popover>
    );
}