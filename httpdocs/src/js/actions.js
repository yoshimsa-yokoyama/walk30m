import _ from 'lodash';
import request from 'superagent';
import {browserHistory} from 'react-router';
import ja from './locale_ja';
import Walk30mUtils from './Walk30mUtils';
import { PUBLIC_API_URL_BASE } from './config';
import Calculation from './domain/Calculation';
import CalculationService from './domain/CalculationService';
import routeProvider from './domain/RouteProvider';
import toKML from 'tokml';

function createGeoJson(calculations) {
  return {
    type: 'FeatureCollection',
    features: calculations.map(calc => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          calc.settings.origin.lng,
          calc.settings.origin.lat,
        ]
      },
      properties: {
        name: calc.settings.origin.address,
      },
    })),
  };
}

export function notify(view, level, message, timeout = 3000) {
  view.setState({notification: {level, message}});
  if (timeout > 0) {
    setTimeout(() => view.setState({notification: null}), timeout);
  }
}

export function handleChangeSettings(view, property, value) {
  return view.setState(prev => {
    switch (property) {
      case 'origin':
        return {
          mySettings: prev.mySettings.withOrigin(value),
        };
      case 'travelMode':
        return {mySettings: prev.mySettings.withTravelMode(value)};
      case 'time':
        return {mySettings: prev.mySettings.withTime(value)};
      case 'preference':
        return {mySettings: prev.mySettings.withPreference(value)};
      case 'avoidTolls':
        return {mySettings: prev.mySettings.withAvoidTolls(value)};
      case 'avoidHighways':
        return {mySettings: prev.mySettings.withAvoidHighways(value)};
      case 'avoidFerries':
        return {mySettings: prev.mySettings.withAvoidFerries(value)};
    }
  });
}

export function handleClickRecommendItem(view, item) {
  const {origin, travelMode, time} = item.params || {};

  browserHistory.push('/home');

  view.setState(prev => ({
    mySettings: prev.mySettings
      .withOrigin(origin)
      .withTravelMode(travelMode)
      .withTime(time),
    mapVersion: +new Date(),
    mapCenter: _.pick(origin, 'lat', 'lng'),
    mapZoom: 16,
  }));
}

export function handleClickShowAdvancedSettingsButton(view) {
  view.setState(prev => ({
    advancedSettingsShown: !prev.advancedSettingsShown,
    status: prev.advancedSettingsShown === false ? 'normal' : 'entrance',
    menuShown: prev.advancedSettingsShown,
  }));
}

export function handleClickMenuButton(view) {
  view.setState({menuShown: true});
}

export function handleClickInitializeAdvancedSettingsButton(view) {
  view.setState(prev => ({
    mySettings: prev.mySettings.withDefaultAdvancedSettings(),
  }), () => {
    notify(view, 'I', '詳細設定を初期化しました。');
  });
}

export function handleClickExecuteButton(view) {
  view.setState({
    status: 'normal',
    advancedSettingsShown: false,
    recommendShown: false,
  }, () => {
    const settings = view.state.mySettings;
    const summary = Walk30mUtils.createSummary(settings);
    const description = _.template(ja.summaryTpl)(Object.assign({}, summary, {
      originAddress: settings.origin.address,
      travelModeExpr: ja.travelModes[settings.travelMode],
    }));
    const calc = new Calculation(settings);

    notify(view, 'I', '計算を開始しました。');

    view.bindCalculation(calc);
    browserHistory.push(`/home/calculations/${calc.id}`);

    calc.start(new CalculationService(routeProvider));
  });
}

export function handleClickRecommendToggleButton(view) {
  view.setState(prev => ({
    recommendShown: !prev.recommendShown,
    calculationsShown: prev.recommendShown ? prev.calculationsShown : false,
  }));
}

export function handleChangeInquiryMessage(view, inquiryMessage) {
  view.setState({inquiryMessage});
}

export function handleClickSubmitInquiryMessageButton(view) {
  request
    .post(`${PUBLIC_API_URL_BASE}/messages`)
    .set('Content-Type': 'application/json; charset=UTF-8')
    .send({
      message: view.state.inquiryMessage,
    }).end((err, data) => {
      if (err) {
        notify(view, 'E', err && err.message);
      } else {
        view.setState({inquiryMessage: ''});
        notify(view, 'I', '送信しました');
      }
    });
}

export function handleClickAbortButton(view) {
  view.state.calculations
    .filter(calc => calc.isInProgress)
    .map(calc => calc.abort());
}

export function handleMapBoundsChange(view, mapCenter, mapZoom) {
  view.setState({mapVersion: +new Date(), mapZoom, mapCenter});
}

export function handleClickCalculationsToggleButton(view) {
  view.setState(prev => ({
    calculationsShown: !prev.calculationsShown,
    recommendShown: prev.calculationsShown ? prev.recommendShown : false,
  }));
}

export function handleClickCalculationDeleteButton(view, clicked) {
  const newCalculations = view.state.calculations.filter(calc => calc !== clicked);

  browserHistory.push('/home');
  view.setState({
    calculations: newCalculations,
    dataVersion: +new Date(),
    calculationsShown: newCalculations.length > 0,
  }, () => {
    notify(view, 'I', '計算結果を削除しました');
  });
}

export function handleClickCalculation(view, clicked) {
  browserHistory.push(`/home/calculations/${clicked.id}`);
  view.setState({
    mapCenter: _.pick(clicked.settings.origin, 'lat', 'lng'),
    mapZoom: 15,
    mapVersion: +new Date(),
  });
}

export function handleCalculationNotFound(view) {
  const calculationId = view.props.location.pathname.split('/')[3];

  notify(view, 'W', `計算 ${calculationId} は削除されたか、参照する権限がありません。`);
  browserHistory.push('/home');
}

export function handleClickCalculationDetailToggleButton(view) {
  view.setState(prev => ({
    showCalculationDetail: !prev.showCalculationDetail,
  }));
}

export function handleClickCalculationRetryButton(view, item) {
  browserHistory.push('/home');
  view.setState({
    advancedSettingsShown: true,
    showCalculationDetail: false,
    mySettings: item.settings,
  });
}

export function handleClickDownloadAllButton(view, dataType) {
  const geoJSON = createGeoJson(view.state.calculations);

  const data = dataType === 'kml'
    ? `data:text/xml;charset=UTF-8,${encodeURIComponent(toKML(geoJSON))}`
    : `data:application/json;charset=UTF-8,${encodeURIComponent(JSON.stringify(geoJSON))}`;

  document.location = data;
}