import { EmailVariable } from '../types/emailBuilder';
import { normalizeSearchText } from './searchText';

/**
 * Extracts all personalization variables in the format {{variableName}} from text
 */
export function getVariablesInText(text: string): string[] {
  if (!text) return [];
  const matches: string[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const varName = match[1].trim();
    if (!matches.includes(varName)) {
      matches.push(varName);
    }
  }
  return matches;
}

/**
 * Analyzes text to find syntax errors in personalization variables (e.g. {var}, {{var)
 */
export function detectVariableWarnings(text: string): string[] {
  if (!text) return [];
  const warnings: string[] = [];
  
  // 1. Single curly braces matching: {Variable} (but not inside {{Variable}})
  // We match { followed by non-curly characters and }
  const singleBraceRegex = /(?<!\{)\{([^{}]+)\}(?!\})/g;
  let match;
  while ((match = singleBraceRegex.exec(text)) !== null) {
    const content = match[1].trim();
    // Exclude cases where it is part of style JSON or CSS
    if (!content.includes(':') && !content.includes(';') && content.length < 50) {
      warnings.push(`Biến "${content}" dùng sai định dạng ngoặc đơn {${content}}. Hãy đổi thành {{${content}}}.`);
    }
  }
  
  // 2. Unclosed double braces: {{Variable
  const unclosedRegex = /\{\{([^{}\n\r\t]+)/g;
  while ((match = unclosedRegex.exec(text)) !== null) {
    const content = match[1].trim();
    // If the captured content does not contain the closing brackets later in the paragraph, trigger warning
    // We check if the next character sequence in the original string has }}
    const index = match.index;
    const remainingText = text.substring(index);
    const firstClose = remainingText.indexOf('}}');
    const nextOpen = remainingText.indexOf('{{', 2);
    
    if (firstClose === -1 || (nextOpen !== -1 && nextOpen < firstClose)) {
      if (content.length < 50) {
        warnings.push(`Biến "${content}" chưa đóng ngoặc nhọn: "{{${content}".`);
      }
    }
  }

  // 3. Excess or unmatched closing braces: Variable}}
  // Find "}}" that doesn't have a preceding "{{"
  const closeBraceRegex = /([^{}\n\r\t]+)\}\}/g;
  while ((match = closeBraceRegex.exec(text)) !== null) {
    const content = match[1].trim();
    const index = match.index;
    const precedingText = text.substring(0, index);
    const lastOpen = precedingText.lastIndexOf('{{');
    const lastClose = precedingText.lastIndexOf('}}');
    
    if (lastOpen === -1 || (lastClose !== -1 && lastClose > lastOpen)) {
      if (content.length < 50) {
        // extract the actual variable name at the end
        const varName = content.split(/[{}]/).pop() || '';
        if (varName && varName.trim()) {
          warnings.push(`Phát hiện đóng ngoặc nhọn dư thừa hoặc thiếu mở ngoặc nhọn gần "${varName.trim()}}}".`);
        }
      }
    }
  }

  return warnings;
}

/**
 * Replaces personalization variables with mock values (for preview) or keeps them intact.
 */
export function replaceVariables(
  text: string,
  variables: EmailVariable[],
  useMock: boolean = false
): string {
  if (!text) return '';
  let result = text;
  
  variables.forEach(v => {
    // Escape special characters for regex
    const escapedKey = v.key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g');
    const replacement = useMock ? v.defaultValue : `{{${v.key}}}`;
    result = result.replace(regex, replacement);
  });

  // A template imported from HTML can contain merge tags that have not yet
  // been added to the global variable picker.  In the real sent/exported
  // email those tags must remain untouched, but Preview's mock-data mode
  // should still be useful and must not leave a half-filled email behind.
  if (useMock) {
    result = result.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawKey: string) => {
      const key = rawKey.trim();
      const normalized = normalizeSearchText(key);

      if (normalized.includes('ho ten') || normalized.includes('ten hoc sinh')) return 'Nguyễn Minh An';
      if (normalized.includes('ngay sinh')) return '15/08/2014';
      if (normalized.includes('khoi')) return '5';
      if (normalized.includes('truong')) return 'Trường Tiểu học Fermat';
      if (normalized.includes('ngay du thi') || normalized.includes('ngay thi')) return '25/10/2026';
      if (normalized.includes('email')) return 'minhan@example.com';
      if (normalized.includes('diem')) return '95';
      if (normalized.includes('giai')) return 'Giải Vàng';

      return `Dữ liệu mẫu: ${key}`;
    });
  }
  
  return result;
}
