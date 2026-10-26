export const WAREHOUSE = {
  id: 'wh',
  name: 'Indiranagar Hub',
  lat: 12.9719,
  lng: 77.6412,
};

export const INITIAL_VEHICLES = [
  { id: 'EV-01', type: 'Electric van', capacity: 180, kwhPerKm: 0.22, fuelPerKm: 0, emissionsPerKm: 0, available: true, electric: true, color: '#5ee6a8' },
  { id: 'VAN-02', type: 'Diesel van', capacity: 240, kwhPerKm: 0, fuelPerKm: 0.115, emissionsPerKm: 0.267, available: true, electric: false, color: '#80aaff' },
  { id: 'VAN-03', type: 'Hybrid van', capacity: 210, kwhPerKm: 0.08, fuelPerKm: 0.072, emissionsPerKm: 0.185, available: true, electric: false, color: '#d5a2ff' },
];

export const INITIAL_DELIVERIES = [
  { id: 'D-101', name: 'MG Road', lat: 12.9756, lng: 77.6066, weight: 32, priority: 'High', deadline: '11:30', status: 'Pending' },
  { id: 'D-102', name: 'Ulsoor', lat: 12.9817, lng: 77.6284, weight: 24, priority: 'Standard', deadline: '12:00', status: 'Pending' },
  { id: 'D-103', name: 'Domlur', lat: 12.9609, lng: 77.6387, weight: 48, priority: 'High', deadline: '11:15', status: 'Pending' },
  { id: 'D-104', name: 'Koramangala', lat: 12.9352, lng: 77.6245, weight: 56, priority: 'Standard', deadline: '13:00', status: 'Pending' },
  { id: 'D-105', name: 'Jayanagar', lat: 12.9250, lng: 77.5838, weight: 42, priority: 'Standard', deadline: '12:30', status: 'Pending' },
  { id: 'D-106', name: 'Shivajinagar', lat: 12.9857, lng: 77.6057, weight: 28, priority: 'High', deadline: '11:45', status: 'Pending' },
  { id: 'D-107', name: 'Whitefield', lat: 12.9698, lng: 77.7500, weight: 62, priority: 'Standard', deadline: '14:00', status: 'Pending' },
  { id: 'D-108', name: 'Hoodi', lat: 12.9894, lng: 77.7112, weight: 36, priority: 'Standard', deadline: '13:30', status: 'Pending' },
];
