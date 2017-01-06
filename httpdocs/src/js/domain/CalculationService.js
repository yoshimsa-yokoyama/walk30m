import _ from 'lodash';
import uuid from 'uuid';
import Emittable from '../utils/Emittable';
import Settings from './Settings';
import {
  meterToLng,
  calcAngle,
  rotate,
  divide,
  distance,
} from './GeoUtil';

function getInitialDestination(calc) {
  const {lat, lng} = calc.settings.origin;

  return {lat, lng: lng + meterToLng(100, lat)};
}

function getArgMaxAngle(origin, ...vectors) {
  if (vectors.length === 0) return null;

  const angles = vectors.map(vector => ({
    vector,
    value: calcAngle(origin, vector),
  }));

  return _.maxBy(angles, 'value').vector;
}

function guessDestination(calc) {
  if (calc.components.length === 0) {
    return getInitialDestination(calc);
  } else {
    const {anglePerStep, origin} = calc.settings;
    const {destination, vertex} = _.last(calc.components);
    const lastEnd = getArgMaxAngle(origin, vertex, destination);

    return rotate(origin, lastEnd, anglePerStep);
  }
}

function getBetterDestination(
    time, origin, destination, routeLeg, vertices, ignoreTooNear = false
) {
  if (!routeLeg) {
    if (vertices.length === 0) {
      return rotate(origin, destination, 60);
    } else {
      return rotate(origin, divide(origin, destination, 0.8), 5);
    }
  }

  const timeTook = routeLeg.duration;
  const wasTooFar = timeTook > time * 1.2;
  const wasTooNear = !ignoreTooNear && !wasTooFar && timeTook < time;

  if (wasTooFar) return divide(origin, destination, 0.8);
  if (wasTooNear) return divide(origin, destination, Math.max(1.1, time / timeTook));
  return null;
}

function improveDestination(
    routeProvider, calc, destination, ignoreTooNear = false) {
  const {origin, time} = calc.settings;

  return new Promise((resolve, reject) => {
    routeProvider.route(
      origin, destination, calc.settings).then((routeLeg) => {

      if (!calc.isInProgress) resolve(null);

      const better = getBetterDestination(
        time, origin, destination, routeLeg, calc.vertices, ignoreTooNear);

      if (!better) {
        resolve({destination, routeLeg});
      } else {
        const distOld = distance(origin, destination);
        const distNew = distance(origin, better);

        improveDestination(
          routeProvider, calc, better, distNew < distOld)
          .then(resolve)
          .catch(reject);
      }
    });
  });
}

function getReachableLocation(path, totalDistance) {
  const distances = _.reduce(path, (passed, pt) => {
    const last = passed.length > 0 ? _.last(passed): null;
    const accum = last ? last.distance : 0;
    const myDistance = last
      ? distance(last.location, pt)
      : 0;

    return passed.concat([
      {location: pt, distance: accum + myDistance, myDistance}
    ]);
  }, []);
  const lastIndex = _.findIndex(distances, d => d.distance >= totalDistance);

  if (lastIndex > 0) {
    const v1 = path[lastIndex];
    const v2 = path[lastIndex - 1];
    const r = v1.distance / v1.myDistance;

    return {
      lat: v2.lat * r + v1.lat * (1 - r),
      lng: v2.lng * r + v1.lng * (1 - r),
    };
  } else {
    return _.last(path);
  }
}

function getAppendableVertex(time, routeLeg) {
  const steps = routeLeg.steps;
  const totalTimes = _.reduce(steps, (passed, step) => {
    const accum = passed.length > 0 ? _.last(passed).time : 0;

    return passed.concat([
      {step, time: accum + step.duration}
    ]);
  }, []);
  const lastComponent = totalTimes.find(d => d.time >= time);

  if (lastComponent) {
    const timeForLastComponent = lastComponent.time - time;
    const speed = routeLeg.distance / routeLeg.duration;
    const distanceInLastComponent = timeForLastComponent * speed;

    return getReachableLocation(
        lastComponent.step.path, distanceInLastComponent);
  } else {
    return routeLeg.endLocation;
  }
}

export default class CalculationService {
  constructor(provider) {
    this._routeProvider = provider;
  }

  computeNext(calc) {
    const {time, origin} = calc.settings;
    const {lat, lng} = origin;
    const guessedDestination = guessDestination(calc);

    return new Promise((resolve, reject) => {
      improveDestination(this._routeProvider, calc, guessedDestination)
        .then(({destination, routeLeg}) => {
          const appendableVertex = getAppendableVertex(time, routeLeg);

          resolve({
            destination,
            vertex: appendableVertex,
            route: _.flatten(routeLeg.steps),
          });
        })
        .catch(reject);
    });
  }
}
