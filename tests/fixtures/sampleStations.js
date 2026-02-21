/**
 * Fixture: sample station & route data for response formatting tests.
 */
const stations = {
    1001: { stationId: 1001, stationName: 'Bến xe Mỹ Đình', lat: 21.0, lng: 105.8 },
    1002: { stationId: 1002, stationName: 'Trần Duy Hưng', lat: 21.01, lng: 105.81 },
    1003: { stationId: 1003, stationName: 'Cầu Giấy', lat: 21.02, lng: 105.82 },
    1004: { stationId: 1004, stationName: 'Nguyễn Trãi', lat: 21.005, lng: 105.805 },
};

const routes = {
    1: { routeId: 1, routeName: 'Tuyến 01', routeType: 1 },
    2: { routeId: 2, routeName: 'Tuyến 02', routeType: 1 },
    3: { routeId: 3, routeName: 'Metro 1', routeType: 2 },
};

module.exports = { stations, routes };
