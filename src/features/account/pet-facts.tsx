// A pet's four facts as a 2×2 grid: the account's pet cards and the admin user
// detail both show it, so it is drawn in one place. No 'use client': it has no
// state, so the server-rendered admin page and the client account tab share it.
import type { Pet } from '@/db/schema/account';
import { GENDER_LABELS } from '@/lib/account/pet';
import { toPersianDigits } from '@/lib/format';

export function PetFacts({
  pet,
}: {
  pet: Pick<Pet, 'age' | 'weight' | 'gender' | 'neutered'>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      {(
        [
          ['سن', pet.age ? toPersianDigits(pet.age) : '—'],
          ['وزن', pet.weight ? toPersianDigits(pet.weight) : '—'],
          ['جنس', GENDER_LABELS[pet.gender]],
          ['عقیم‌شده', pet.neutered ? 'بله' : 'خیر'],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="bg-secondary/50 rounded-lg p-2.5">
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="font-medium">{value}</p>
        </div>
      ))}
    </div>
  );
}
