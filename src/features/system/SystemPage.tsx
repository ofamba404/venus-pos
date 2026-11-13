import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { FlavorDot } from '../../ui/FlavorDot';
import { Segmented } from '../../ui/Segmented';
import { Field } from '../../ui/Field';
import { IconMinus, IconPlus } from '../../ui/icons';
import { useState } from 'preact/hooks';
import { CAT_MAP } from '../../domain/catalog';
import { debugLogText, pushDebug, type DebugEntry } from '../../domain/parity';
import { loadSales } from '../../data/entities';
import { showToast } from '../../ui/ToastHost';

export function SystemPage() {
  const [seg, setSeg] = useState<'a' | 'b'>('a');
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);
  return (
    <section>
      <h1 class="page-title">System</h1>
      <div class="v-section-label">Buttons</div>
      <div class="v-chip-row">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div class="v-section-label">Money / tags / flavours</div>
      <div class="v-chip-row" style={{ alignItems: 'center' }}>
        <Money value={45000} size="xl" />
        <Tag tone="paid">Paid</Tag>
        <Tag tone="credit">Credit</Tag>
        <Tag tone="low">Low</Tag>
        {Object.values(CAT_MAP)
          .slice(0, 6)
          .map((c) => (
            <span key={c.id} class="config-flavor__label">
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
      <Field label="Client" placeholder="Amina" />
      <div class="v-section-label">Debug</div>
      <div class="v-chip-row">
        <Button
          size="md"
          variant="secondary"
          data-testid="debug-capture"
          onClick={() => setDebugLog((log) => pushDebug(log, 'capture'))}
        >
          Capture
        </Button>
        <Button
          size="md"
          variant="secondary"
          data-testid="debug-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(debugLogText(debugLog));
            showToast(debugLog.length ? 'Log copied' : 'Log is empty');
          }}
        >
          Copy log
        </Button>
        <Button
          size="md"
          variant="secondary"
          data-testid="debug-recover"
          onClick={() =>
            void loadSales({ force: true }).then(
              () => showToast('Data reloaded'),
              () => showToast('Could not reload data'),
            )
          }
        >
          Reload from server
        </Button>
      </div>
      <pre data-testid="debug-log">{debugLogText(debugLog)}</pre>
      <div class="v-section-label">Stepper</div>
      <div class="stepper">
        <button type="button" aria-label="Decrease">
          <IconMinus size={18} />
        </button>
        <span class="stepper__n">3</span>
        <button type="button" aria-label="Increase">
          <IconPlus size={18} />
        </button>
      </div>
    </section>
  );
}
