import { useRef, useState } from 'react'
import { parseMdbPayload, listMdbStrecken } from '../../../utils/mdbImport'
import { convertMdbOnServer, OptimizerError } from '../../../utils/optimizerService'
import { ALL_STRECKEN } from '../../../utils/import/mdbPipeline'
import { useI18n } from '../../../locales/i18nContext'

/**
 * An MDB file, read for an import. The browser cannot read an Access file, so
 * it goes to the server, is converted there and deleted again (ROADMAP
 * decision 11); what comes back are the Satzarten, kept out of state, with the
 * line numbers in them and a count of what the file holds.
 */
export default function useMdbFile() {
  const { t } = useI18n()
  const payloadRef = useRef(null)
  const [name, setName] = useState('')
  const [strecken, setStrecken] = useState([])
  const [strecke, setStrecke] = useState('')
  const [counts, setCounts] = useState(null)
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)

  const read = async (file) => {
    setErrors([]); setBusy(true); setStrecken([]); setCounts(null)
    setName(file.name)
    try {
      const payload = parseMdbPayload(await convertMdbOnServer(file))
      payloadRef.current = payload
      setCounts(payload.elements.length ? {
        elements: payload.elements.length, tracks: payload.tracks.length, nodes: payload.nodes.length,
      } : null)
      const list = listMdbStrecken(payload)
      setStrecken(list)
      setStrecke(ALL_STRECKEN)
      if (!list.length) setErrors([t('data_exchange_mdb_err_empty')])
    } catch (err) {
      payloadRef.current = null
      const code = err instanceof OptimizerError ? err.code : 'internal'
      setErrors([t(`data_exchange_mdb_err_${code}`) ?? code, ...(err?.detail ? [err.detail] : [])])
    } finally {
      setBusy(false)
    }
  }

  return { payloadRef, name, strecken, strecke, setStrecke, counts, errors, setErrors, busy, setBusy, read }
}
