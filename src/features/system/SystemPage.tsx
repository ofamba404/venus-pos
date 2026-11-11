import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { FlavorDot } from '../../ui/FlavorDot';
import { Segmented } from '../../ui/Segmented';
import { Field } from '../../ui/Field';
import { useState } from 'preact/hooks';
import { CAT_MAP } from '../../domain/catalog';

export function SystemPage() {
  const [seg, setSeg] = useState<'a' | 'b'>('a');
  return (
    <section>
      <h1 class="page-title">System</h1>
      <div class="v-section-label">Buttons</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div class="v-section-label">Money / tags / flavours</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Money value={45000} size="xl" />
        <Tag tone="paid">Paid</Tag>
        <Tag tone="credit">Credit</Tag>
        <Tag tone="low">Low</Tag>
        {Object.values(CAT_MAP)
          .slice(0, 6)
          .map((c) => (
            <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FlavorDot color={c.color} size="lg" />
              {c.name}
            </span>
          ))}
      </div>
      <div class="v-section-label">Inputs</div>
      <Segmented
        value={seg}
        onChange={setSeg}
        options={[
          { id: 'a', label: 'Paid' },
          { id: 'b', label: 'Credit' },
        ]}
      />
      <div style={{ height: 12 }} />
      <Field label="Customer" placeholder="Amina" />
    </section>
  );
}
