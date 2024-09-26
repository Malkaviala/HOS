let map;
let directionsService;
let directionsRenderer;

// HOS Tracker Class
class HOSTracker {
    constructor(initialCycleTime) {
        this.cycleTime = initialCycleTime;
        this.drivingTime = 0;
        this.onDutyTime = 0;
        this.lastRestPeriod = new Date();
    }

    drive(hours) {
        this.drivingTime += hours;
        this.onDutyTime += hours;
        this.cycleTime -= hours;
    }

    onDuty(hours) {
        this.onDutyTime += hours;
        this.cycleTime -= hours;
    }

    rest(hours) {
        if (hours >= 10) {
            this.lastRestPeriod = new Date();
            this.drivingTime = 0;
            this.onDutyTime = 0;
        }
    }

    getAvailableHOS() {
        const availableDriving = Math.min(11 - this.drivingTime, 14 - this.onDutyTime);
        const availableOnDuty = 14 - this.onDutyTime;
        return {
            drivingTime: Math.max(availableDriving, 0),
            onDutyTime: Math.max(availableOnDuty, 0),
            cycleTime: Math.max(this.cycleTime, 0)
        };
    }
}

// Initialize Google Maps
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 37.7749, lng: -122.4194 },
        zoom: 6
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
    directionsRenderer.setMap(map);

    // Initialize autocomplete for start and end locations
    new google.maps.places.Autocomplete(document.getElementById('startLocation'));
    new google.maps.places.Autocomplete(document.getElementById('endLocation'));

    // Initialize autocomplete for intermediate stops
    initializeStopAutocomplete();
}

function initializeStopAutocomplete() {
    document.querySelectorAll('.stopLocation').forEach(input => {
        new google.maps.places.Autocomplete(input);
    });
}

// Add stop button functionality
document.getElementById('addStopBtn').addEventListener('click', function() {
    const stopContainer = document.getElementById('stopContainer');
    const newStopGroup = document.createElement('div');
    newStopGroup.className = 'stop-group';
    newStopGroup.innerHTML = '<input type="text" class="stopLocation" placeholder="Enter stop location"><br>';
    stopContainer.appendChild(newStopGroup);
    initializeStopAutocomplete();
});

// Form submission handler
document.getElementById('hosForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const startLocation = document.getElementById('startLocation').value;
    const startDate = new Date(document.getElementById('startDate').value);
    const endLocation = document.getElementById('endLocation').value;
    const availableDrivingTime = parseFloat(document.getElementById('availableDrivingTime').value);
    const onDutyTime = parseFloat(document.getElementById('onDutyTime').value);
    const cycleTime = parseFloat(document.getElementById('cycleTime').value);

    // Gather intermediate stops
    const stops = Array.from(document.querySelectorAll('.stopLocation'))
        .map(input => input.value)
        .filter(stop => stop.trim() !== '');

    try {
        const routeData = await calculateRoute(startLocation, endLocation, stops);
        const tripPlan = planTrip(routeData.distance, 55, startDate, cycleTime); // Assuming average speed of 55 mph
        displayResults(tripPlan, routeData);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('output').innerHTML = 'An error occurred while calculating the route.';
    }
});

// Calculate route using Google Maps Directions Service
function calculateRoute(start, end, waypoints) {
    return new Promise((resolve, reject) => {
        const waypointList = waypoints.map(location => ({ location: location, stopover: true }));
        const request = {
            origin: start,
            destination: end,
            waypoints: waypointList,
            travelMode: 'DRIVING'
        };

        directionsService.route(request, (result, status) => {
            if (status === 'OK') {
                directionsRenderer.setDirections(result);
                const totalDistance = result.routes[0].legs.reduce((sum, leg) => sum + leg.distance.value, 0) / 1609.34; // Convert meters to miles
                const totalDuration = result.routes[0].legs.reduce((sum, leg) => sum + leg.duration.value, 0) / 3600; // Convert seconds to hours
                resolve({ distance: totalDistance, duration: totalDuration });
            } else {
                reject('Directions request failed due to ' + status);
            }
        });
    });
}

// Trip Planner Function
function planTrip(totalDistance, avgSpeed, startDate, initialCycleTime) {
    const hosTracker = new HOSTracker(initialCycleTime);
    let currentDate = new Date(startDate);
    let remainingDistance = totalDistance;
    let itinerary = [];
    let dayCount = 1;

    // Get the maximum driving hours per day from the user's input
    const maxDrivingHoursPerDay = parseFloat(document.getElementById('maxDrivingHours').value);

    while (remainingDistance > 0) {
        let dayStart = new Date(currentDate);
        let availableHOS = hosTracker.getAvailableHOS();
        let drivingHours = Math.min(availableHOS.drivingTime, remainingDistance / avgSpeed, maxDrivingHoursPerDay);
        
        // Ensure we don't exceed the user-defined driving hours per day
        drivingHours = Math.min(drivingHours, maxDrivingHoursPerDay);

        // Calculate distance driven and update remaining distance
        let distanceDriven = drivingHours * avgSpeed;
        remainingDistance -= distanceDriven;

        // Update HOS tracker
        hosTracker.drive(drivingHours);

        // Calculate end time for the day
        let dayEnd = new Date(dayStart);
        dayEnd.setHours(dayEnd.getHours() + drivingHours);

        // Add 30-minute break if driving more than 8 hours
        if (drivingHours > 8) {
            dayEnd.setMinutes(dayEnd.getMinutes() + 30);
            hosTracker.onDuty(0.5);
        }

        // Add day to itinerary
        itinerary.push({
            day: dayCount,
            date: formatDate(dayStart),
            startTime: formatTime(dayStart),
            endTime: formatTime(dayEnd),
            drivingHours: drivingHours.toFixed(2),
            distanceDriven: distanceDriven.toFixed(2)
        });

        // If this is the last day (remaining distance is 0), don't add rest period
        if (remainingDistance > 0) {
            // Move to next day
            currentDate = new Date(dayEnd);
            currentDate.setHours(currentDate.getHours() + 10); // 10-hour rest period
            hosTracker.rest(10);
        } else {
            // Set current date as the arrival date (same day)
            currentDate = new Date(dayEnd);
        }
        dayCount++;
    }

    return {
        itinerary: itinerary,
        finalHOS: hosTracker.getAvailableHOS(),
        arrivalDateTime: currentDate
    };
}


// Display results
function displayResults(tripPlan, routeData) {
    let output = `
        <h2>HOS Stop Planner Results:</h2>
        <p>Total Distance: ${routeData.distance.toFixed(2)} miles</p>
        <p>Estimated Driving Time: ${routeData.duration.toFixed(2)} hours</p>
        <h3>Itinerary:</h3>
    `;

    tripPlan.itinerary.forEach(day => {
        output += `
            <p>Day ${day.day} (${day.date}):</p>
            <p>Start: ${day.startTime}</p>
            <p>End: ${day.endTime}</p>
            <p>Driving Time: ${day.drivingHours} hours</p>
            <p>Distance Driven: ${day.distanceDriven} miles</p>
        `;
    });

    output += `
        <h3>Arrival at Destination:</h3>
        <p>Date and Time: ${formatDate(tripPlan.arrivalDateTime)} ${formatTime(tripPlan.arrivalDateTime)}</p>
        <h3>Final Available HOS at Destination:</h3>
        <p>Available Driving Time: ${tripPlan.finalHOS.drivingTime.toFixed(2)} hours</p>
        <p>Available On-Duty Time: ${tripPlan.finalHOS.onDutyTime.toFixed(2)} hours</p>
        <p>Available Cycle Time: ${tripPlan.finalHOS.cycleTime.toFixed(2)} hours</p>
    `;

    document.getElementById('output').innerHTML = output;
}

// Helper functions for formatting dates and times
function formatDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Initialize the map when the Google Maps API is loaded
window.initMap = initMap;
