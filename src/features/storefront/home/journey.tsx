'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight } from 'lucide-react';
import {
  QUIZ_AGES,
  QUIZ_NEEDS,
  QUIZ_PETS,
  quizFilters,
  type QuizNeed,
} from './quiz';
import type { PetType } from '@/db/schema/catalog';
import type { ContentValue } from '@/lib/content/site-content';
import { shopPath } from '@/lib/constant/paths';

const optionButton =
  'rounded-xl border-2 border-border hover:border-accent-strong hover:bg-accent/5 font-medium transition-colors duration-200';

/**
 * «برای کی خرید می‌کنی؟» — the personalized-journey quiz.
 *
 * Entirely client-side and stateless, by the story's acceptance criteria:
 * nothing is stored, nothing is sent, and the only output is a `/shop?…` deep
 * link whose parameters are the catalog API's own (see `quiz.ts`).
 *
 * The section's chrome (eyebrow, headline, intro) is admin content; the quiz
 * itself — its questions, options, the result sentence and the filters they map
 * to — stays in code, because that copy is interpolated into sentences and mapped
 * to catalog filters, not free editorial text.
 */
export function JourneySection({
  content,
}: {
  content: ContentValue<'home.journey'>;
}) {
  const [step, setStep] = useState(0);
  const [pet, setPet] = useState<PetType | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [need, setNeed] = useState<QuizNeed | null>(null);

  const petLabel = QUIZ_PETS.find((option) => option.value === pet)?.label;

  const reset = () => {
    setStep(0);
    setPet(null);
    setAge(null);
    setNeed(null);
  };

  return (
    <section className="py-24">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-8">
        <span className="text-accent-strong mb-3 inline-block text-sm font-medium">
          {content.eyebrow}
        </span>
        <h2 className="mb-3 text-4xl font-black">{content.headline}</h2>
        <p className="text-muted-foreground mb-12 whitespace-pre-line">
          {content.body}
        </p>

        <div className="bg-card border-border rounded-3xl border p-8 shadow-sm">
          {step === 0 && (
            <div>
              <p className="mb-6 text-lg font-semibold">حیوان خانگی شما؟</p>
              <div className="flex justify-center gap-4">
                {QUIZ_PETS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setPet(option.value);
                      setStep(1);
                    }}
                    className={`${optionButton} group flex flex-col items-center gap-3 px-12 py-8`}
                    data-umami-event="home-quiz-pet-select"
                  >
                    <span className="text-5xl" aria-hidden="true">
                      {option.emoji}
                    </span>
                    <span className="group-hover:text-accent-strong font-semibold">
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="mb-6 text-lg font-semibold">
                سن {petLabel}ت چقدره؟
              </p>
              <div className="flex flex-col gap-3">
                {QUIZ_AGES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setAge(option);
                      setStep(2);
                    }}
                    className={`${optionButton} px-6 py-4 text-start`}
                    data-umami-event="home-quiz-age-select"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-6 text-lg font-semibold">بیشترین نیاز؟</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {QUIZ_NEEDS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => {
                      setNeed(option);
                      setStep(3);
                    }}
                    className={`${optionButton} px-4 py-4`}
                    data-umami-event="home-quiz-need-select"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="bg-success/20 mx-auto mb-4 flex size-16 items-center justify-center rounded-full">
                <Check
                  size={32}
                  className="text-success-strong"
                  aria-hidden="true"
                />
              </div>
              <p className="mb-2 text-lg font-bold">محصولات مناسب پیدا شد!</p>
              {/* Age is read back here and nowhere else — the catalog has no
                  age field, so it never becomes a filter (see quiz.ts). */}
              <p className="text-muted-foreground mb-6">
                برای {petLabel} {age} با نیاز {need?.label}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href={shopPath(quizFilters({ pet, need }))}
                  className="bg-accent-strong hover:bg-accent-hover rounded-xl px-6 py-3 font-bold text-white transition-colors"
                  data-umami-event="home-quiz-results-click"
                >
                  مشاهده محصولات
                </Link>
                <button
                  type="button"
                  onClick={reset}
                  className="border-border hover:bg-secondary rounded-xl border-2 px-6 py-3 font-medium transition-colors"
                  data-umami-event="home-quiz-restart"
                >
                  شروع مجدد
                </button>
              </div>
            </div>
          )}

          {step > 0 && step < 3 && (
            <button
              type="button"
              onClick={() => setStep((current) => current - 1)}
              className="text-muted-foreground hover:text-foreground mx-auto mt-6 flex items-center gap-1 px-2 py-2 text-sm"
              data-umami-event="home-quiz-back"
            >
              {/* Backwards in RTL points right. */}
              <ChevronRight size={14} aria-hidden="true" />
              بازگشت
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
