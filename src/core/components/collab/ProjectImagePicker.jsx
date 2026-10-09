import { PROJECT_IMAGES, fileToProjectImage, projectImageUrl } from '../../utils/projectImages'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'

/**
 * The picture of a new project: none, one of the default pictures, or a file
 * of the user's own. `value` is { kind: 'none' } | { kind: 'preset', key } |
 * { kind: 'file', dataUrl } — `dataUrl` null until a file was chosen; it is
 * both the preview and what is uploaded, already fitted to the 4:3 slot with
 * a white margin (fileToProjectImage).
 *
 * Native radio buttons under the tiles, so the arrow keys move through them
 * like through any other choice of one.
 */
export default function ProjectImagePicker({ value, onChange, disabled = false }) {
  const { t } = useI18n()
  const ownUrl = value.kind === 'file' ? value.dataUrl : null

  const option = (id, checked, onSelect, label, content) => (
    <label key={id} className="image-option" title={label}>
      <input type="radio" name="project-image" value={id} checked={checked}
        onChange={onSelect} aria-label={label} />
      <span className="image-option-tile">{content}</span>
    </label>
  )

  const pickFile = async (e) => {
    const file = e.target.files?.[0] ?? null
    onChange({ kind: 'file', dataUrl: file ? await fileToProjectImage(file) : null })
  }

  const preset = value.kind === 'preset' ? PROJECT_IMAGES.find(i => i.key === value.key) : null

  return (
    <fieldset className="image-picker" disabled={disabled}>
      <legend>{t('start_field_image')}</legend>
      <div className="image-picker-grid">
        {option('none', value.kind === 'none', () => onChange({ kind: 'none' }), t('project_image_none'),
          <span className="image-option-text">{t('project_image_none')}</span>)}
        {PROJECT_IMAGES.map(img => option(img.key, value.kind === 'preset' && value.key === img.key,
          () => onChange({ kind: 'preset', key: img.key }), t(img.labelKey),
          <img src={projectImageUrl(img)} alt="" width="64" height="48" />))}
        {option('file', value.kind === 'file', () => onChange({ kind: 'file', dataUrl: ownUrl }), t('project_image_own'),
          ownUrl
            ? <img src={ownUrl} alt="" width="64" height="48" />
            : <span className="image-option-text">{t('project_image_own')}</span>)}
      </div>
      {preset && <p className="image-picker-caption">{t(preset.labelKey)}</p>}
      {value.kind === 'file' && (
        <label className="collab-field">
          <span>{t('project_image_own')}</span>
          <input type="file" accept="image/*" onChange={pickFile} />
        </label>
      )}
      <p className="image-picker-credit">{t('project_image_credit')}</p>
    </fieldset>
  )
}
