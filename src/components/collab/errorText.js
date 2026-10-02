import { tOr } from '../../locales/i18n'

/**
 * What the server's error `code` means, in words: its own text where the
 * locale has one (`prefix` + code), the generic one otherwise.
 */
export const errorText = (t, code, prefix = 'collab_err_') => tOr(t, `${prefix}${code}`, t('collab_err_generic'))
