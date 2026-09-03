import { useState, useMemo, useCallback } from 'react';
import { buildSlashCommands } from '../services/slashCommandRegistry';

export function useSlashCommands({ mcpServers = [], browserTools = [], skills = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands = useMemo(
    () => buildSlashCommands(mcpServers, browserTools, skills),
    [mcpServers, browserTools, skills]
  );

  const filtered = useMemo(() => {
    if (!query.startsWith('/')) return [];
    const q = query.toLowerCase();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().startsWith(q) ||
      (cmd.description || '').toLowerCase().includes(q)
    ).slice(0, 12);
  }, [query, commands]);

  const handleInput = useCallback((value) => {
    setQuery(value);
    if (value.startsWith('/') && value.length > 0) {
      setIsOpen(true);
      setSelectedIndex(0);
    } else {
      setIsOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (!isOpen || !filtered.length) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && isOpen)) {
      e.preventDefault();
      return filtered[selectedIndex] || null;
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
      return true;
    }
    return false;
  }, [isOpen, filtered, selectedIndex]);

  const selectCommand = useCallback((command) => {
    setIsOpen(false);
    return command.label + ' ';
  }, []);

  return {
    isOpen,
    filtered,
    selectedIndex,
    setSelectedIndex,
    handleInput,
    handleKeyDown,
    selectCommand
  };
}
