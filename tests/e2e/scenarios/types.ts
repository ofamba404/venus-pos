export type ScenarioStep =
  | { do: 'addProduct'; product: string; flavors?: Record<string, number>; qty?: number }
  | { do: 'setClient'; name: string }
  | { do: 'setCredit'; value: boolean }
  | { do: 'charge' }
  | { expect: 'saleRecorded'; total: number }
  | { expect: 'toast'; message: string };

export type Scenario = {
  id: string;
  title: string;
  role: 'pos_admin' | 'pos_staff';
  seed: 'default' | 'empty';
  steps: ScenarioStep[];
};
