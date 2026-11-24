import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HarvestMapComponent } from './features/harvest-map/harvest-map.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HarvestMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-harvest-map />'
})
export class AppComponent {}
