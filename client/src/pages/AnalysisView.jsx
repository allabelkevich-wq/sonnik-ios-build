import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SparklesIcon,
  MagnifyingGlassIcon,
  HeartIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentListIcon,
  ExclamationCircleIcon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid';
import EdgeCard from '../components/EdgeCard.jsx';
import SectionLabel from '../components/SectionLabel.jsx';
import Constellation from '../components/Constellation.jsx';
import Disclosure from '../components/Disclosure.jsx';
import PillButton from '../components/PillButton.jsx';
import { SYNODIC, moonPath } from '../utils/moon.js';
import '../styles/result.css';

// Подпись внутри секции: «ТЕЛО И ЭМОЦИИ», «ПРИЗНАНИЕ», «АФФИРМАЦИЯ».
function StepLabel({ children, color = 'var(--v3-fg-4)' }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.14em',
      textTransform: 'uppercase', color, marginBottom: 5,
    }}>
      {children}
    </div>
  );
}

export default function AnalysisView({ analysis, onRetry, onJournal, onChat }) {
  const { t } = useTranslation();
  // Раскрыты только символы: разбор читается сверху вниз, остальное — по желанию.
  const [open, setOpen] = useState({ symbols: true, body: false, ritual: false });

  if (!analysis) {
    return (
      <div className="r-analysis" style={{
        padding: '60px 20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 16, textAlign: 'center',
      }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%',
          background: 'var(--v3-tile)', border: '1px solid var(--v3-tile-br)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ExclamationCircleIcon style={{ width: 28, height: 28, color: 'var(--v3-fg-4)' }} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--v3-fg)' }}>{t('success.notFoundTitle')}</div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--v3-fg-3)', maxWidth: 250 }}>
          {t('success.notFoundHint')}
        </div>
        {(onRetry || onJournal) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%', marginTop: 6 }}>
            {onRetry && <PillButton tone="violet" size="lg" onClick={onRetry}>{t('success.retryAnalysis')}</PillButton>}
            {onJournal && <PillButton tone="neutral" size="lg" onClick={onJournal}>{t('success.journal')}</PillButton>}
          </div>
        )}
      </div>
    );
  }

  const lunarNum = analysis.lunar_data?.day_number ?? analysis.lunar_data?.tithi;
  const lunarMeaning = analysis.lunar_data?.day_meaning ?? analysis.lunar_data?.tithi_meaning;

  const symbols = analysis.symbols || [];
  const patterns = analysis.destructive_patterns || [];
  const rituals = analysis.ritual_reprogramming || [];
  const transformations = analysis.transformations || [];
  const rec = analysis.recommendations || {};

  const hasSymbols = symbols.length > 0;
  const hasBody = Boolean(analysis.psychosomatic || analysis.family_context);
  const hasRitual = patterns.length > 0 || rituals.length > 0 || transformations.length > 0;
  const sections = [hasSymbols, hasBody, hasRitual].filter(Boolean).length;
  const opened = [hasSymbols && open.symbols, hasBody && open.body, hasRitual && open.ritual].filter(Boolean).length;
  const hasPractice = Boolean(rec.practice || rec.affirmation || rec.ritual);

  // Фазу считает бэкенд (astronomy-engine) — клиент лишь рисует серп по номеру
  // лунного дня: середина суток лунного дня в долях синодического месяца.
  const moonFrac = lunarNum != null ? (lunarNum - 0.5) / SYNODIC : 0;

  const patternsHint = [
    patterns.length > 0 ? t('success.patternsFound', { count: patterns.length }) : '',
    rituals.length > 0 ? t('success.hasRitual') : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="r-analysis" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Послание ── */}
      {analysis.final_message && (
        <EdgeCard edge="quote" padding="22px 20px">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 22, height: 1, background: 'var(--v3-purple-line)' }} />
              <SparklesIcon style={{ width: 17, height: 17, color: 'var(--v3-purple-txt)' }} />
              <span style={{ width: 22, height: 1, background: 'var(--v3-purple-line2)' }} />
            </div>
            <div style={{ fontSize: 16.5, fontWeight: 600, fontStyle: 'italic', lineHeight: 1.62, color: 'var(--v3-fg)' }}>
              «{analysis.final_message}»
            </div>
          </div>
        </EdgeCard>
      )}

      {/* ── Что говорит этот сон + лунный день ── */}
      {analysis.brief_analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionLabel title={t('analysis.whatSays')} />
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--v3-fg-2)', margin: 0 }}>
            {analysis.brief_analysis}
          </p>
          {/* Оракул — единственное, что тянет человека дальше первого разбора,
              а кнопка к нему стояла в самом низу: за неделю до неё дошли трое. */}
          {onChat && (
            <button type="button" onClick={onChat} style={{
              alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6,
              minHeight: 44, padding: 0, background: 'none', border: 'none', boxShadow: 'none',
              fontSize: 13.5, fontWeight: 600, color: 'var(--v3-gold-txt)', cursor: 'pointer', width: 'auto',
            }}>
              <ChatBubbleLeftRightIcon style={{ width: 15, height: 15 }} />
              {t('analysis.askOracle')}
              <ChevronRightIcon style={{ width: 13, height: 13 }} />
            </button>
          )}
          {lunarNum != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px',
              borderRadius: 16, background: 'var(--v3-chip-g)', border: '1px solid var(--v3-chip-g-br)',
            }}>
              <svg viewBox="-50 -50 100 100" width={42} height={42} style={{ flexShrink: 0 }} aria-hidden="true">
                <circle r={48} fill="var(--v3-moon-dark)" stroke="var(--v3-moon-ring)" strokeWidth={1} />
                <path d={moonPath(moonFrac, 48)} fill="var(--v3-moon-lit)" />
              </svg>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--v3-fg-4)' }}>{t('analysis.lunarDay')}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--v3-gold-txt)', marginTop: 2 }}>
                  {lunarNum}{t('analysis.lunarDaySuffix')}{lunarMeaning ? ` · ${lunarMeaning}` : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {sections > 0 && <Constellation />}

      {/* ── Разбор: три раскрывающиеся секции ── */}
      {sections > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionLabel title={t('success.breakdown')} right={t('success.openedOf', { n: opened, total: sections })} />

          {hasSymbols && (
            <Disclosure
              open={open.symbols}
              onToggle={() => setOpen(s => ({ ...s, symbols: !s.symbols }))}
              title={t('analysis.symbols')}
              subtitle={symbols.slice(0, 3).map(s => s.symbol).join(', ')}
              icon={<MagnifyingGlassIcon style={{ width: 16, height: 16 }} />}
            >
              {symbols.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 11, padding: '11px 13px',
                  borderRadius: 12, background: 'var(--v3-inset)',
                }}>
                  <span style={{ width: 2, flexShrink: 0, borderRadius: 2, background: 'var(--v3-gold-bar)' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--v3-fg)', overflowWrap: 'anywhere' }}>
                      {s.symbol}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)', marginTop: 3 }}>
                      {s.meaning}
                    </div>
                  </div>
                </div>
              ))}
            </Disclosure>
          )}

          {hasBody && (
            <Disclosure
              open={open.body}
              onToggle={() => setOpen(s => ({ ...s, body: !s.body }))}
              title={t('success.bodyAndLineage')}
              subtitle={t('success.bodyAndLineageHint')}
              tone="violet"
              icon={<HeartIcon style={{ width: 16, height: 16 }} />}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {analysis.psychosomatic && (
                  <div>
                    <StepLabel>{t('analysis.bodyEmotionsTitle')}</StepLabel>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--v3-fg-2)' }}>{analysis.psychosomatic}</div>
                  </div>
                )}
                {analysis.family_context && (
                  <div>
                    <StepLabel>{t('analysis.ancestralContextTitle')}</StepLabel>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--v3-fg-2)' }}>{analysis.family_context}</div>
                  </div>
                )}
              </div>
            </Disclosure>
          )}

          {hasRitual && (
            <Disclosure
              open={open.ritual}
              onToggle={() => setOpen(s => ({ ...s, ritual: !s.ritual }))}
              title={t('analysis.patterns')}
              subtitle={patternsHint}
              tone="danger"
              icon={<ExclamationTriangleIcon style={{ width: 16, height: 16 }} />}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rituals.length > 0 && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-fg-3)' }}>
                    {t('analysis.ritualInstruction')}
                  </div>
                )}

                {/* Без ритуала программы всё равно надо назвать — простыми строками. */}
                {rituals.length === 0 && patterns.map((pattern, i) => (
                  <div key={i} style={{
                    fontSize: 12.5, lineHeight: 1.55, color: 'var(--v3-danger)',
                    padding: '10px 13px', borderRadius: 12, background: 'var(--v3-danger-chip)',
                  }}>
                    − {pattern}
                  </div>
                ))}

                {rituals.map((ritual, i) => (
                  <div key={i} style={{
                    borderRadius: 14, border: '1px solid var(--v3-tile-br)',
                    overflow: 'hidden', background: 'var(--v3-inset)',
                  }}>
                    <div style={{
                      padding: '10px 13px', fontSize: 12.5, fontWeight: 600,
                      color: 'var(--v3-fg-2)', background: 'var(--r-inset2)',
                    }}>
                      {t('analysis.ritualProgram', { pattern: ritual.pattern })}
                    </div>
                    <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { step: t('analysis.ritualRecognition'), text: ritual.recognition },
                        { step: t('analysis.ritualAcceptance'), text: ritual.acceptance },
                        { step: t('analysis.transformations'), text: ritual.transformation, accent: true },
                      ].map(({ step, text, accent }) => text && (
                        <div key={step}>
                          <StepLabel color={accent ? 'var(--v3-success)' : 'var(--v3-gold-txt)'}>{step}</StepLabel>
                          <div style={{
                            fontSize: 12.5, lineHeight: 1.6, fontStyle: 'italic', color: 'var(--v3-fg-2)',
                            padding: '8px 12px', borderRadius: 9,
                            background: accent ? 'var(--v3-chip-s)' : 'var(--r-inset2)',
                            borderLeft: accent ? '3px solid var(--v3-success)' : 'none',
                          }}>
                            «{text}»
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {transformations.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {transformations.map((tr, i) => (
                      <div key={i} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--v3-tile-br)' }}>
                        <div style={{
                          padding: '10px 13px', fontSize: 12.5, color: 'var(--v3-danger)',
                          background: 'var(--v3-danger-chip)', borderBottom: '1px solid var(--v3-tile-br)',
                        }}>
                          − {tr.old}
                        </div>
                        <div style={{
                          padding: '10px 13px', fontSize: 12.5,
                          color: 'var(--v3-success)', background: 'var(--v3-chip-s)',
                        }}>
                          + {tr.new}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Disclosure>
          )}
        </div>
      )}

      {/* ── Практика на сегодня ── */}
      {hasPractice && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionLabel title={t('analysis.todayPracticeTitle')} tone="success" />
          <div style={{
            borderRadius: 20, border: '1px solid var(--v3-chip-s-br)', background: 'var(--v3-practice)',
            padding: 16, display: 'flex', flexDirection: 'column', gap: 13,
          }}>
            {rec.practice && (
              <div style={{ display: 'flex', gap: 11 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                  background: 'var(--v3-chip-s)', border: '1px solid var(--v3-chip-s-br)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ClipboardDocumentListIcon style={{ width: 15, height: 15, color: 'var(--v3-success)' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <StepLabel>{t('analysis.practiceLabel')}</StepLabel>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--v3-fg-2)' }}>{rec.practice}</div>
                </div>
              </div>
            )}
            {rec.affirmation && (
              <div style={{
                padding: '12px 14px', borderRadius: 14,
                background: 'var(--v3-inset)', borderLeft: '3px solid var(--r-gold-bar-solid)',
              }}>
                <StepLabel>{t('analysis.affirmationLabel')}</StepLabel>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, fontStyle: 'italic', color: 'var(--v3-gold-txt)' }}>
                  «{rec.affirmation}»
                </div>
              </div>
            )}
            {rec.ritual && (
              <div style={{ paddingLeft: 39 }}>
                <StepLabel>{t('analysis.ritualLabel')}</StepLabel>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--v3-fg-2)' }}>{rec.ritual}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
