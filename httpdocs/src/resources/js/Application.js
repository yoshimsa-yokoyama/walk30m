import window from "window";
import $ from "jQuery";
import _ from "lodash";
import google from "google";
import CalculationService from "./CalculationService";
import Logger from "./Logger";
import GeoUtil from "./GeoUtil";
import Walk30mUtils from "./Walk30mUtils";
import AdvancedSettingsController from "./AdvancedSettingsController";
import ProgressBar from "./ProgressBar";
import MapController from "./MapController";
import InputController from "./InputController";

class Application {

  constructor($el) {
    var startDate = new Date();
    
    this.messages = window.messages;
    this.$el = $el;
    this.$page = $('html,body');
    this.$gotoTopBtn = $el.find('.btn[role=goto-top]');
    this.$execBtn = $el.find('.btn[role=execute]');
    this.$cancelBtn = $el.find('#control span[role=cancel]');
    this.$sendMsgBtn = $el.find('.btn[role=send-message]');
    this.$goToAboutLink = $el.find('a[href=#about]');
    this.$message = $el.find('#message textarea');
    this.$goToAdvancedSettingsLink = $el.find('a[href=#advanced-settings]');
    this.calcService = new CalculationService();
    this.logger = new Logger(this.calcService);
    this.advancedSettingsController = new AdvancedSettingsController($el.find('#advanced-settings'));

    $el.find('#extra').css({ top: Math.min($(window).height(), 700) + 'px' });
    this.initEvents();

    $.get(PUBLIC_API_URL_BASE + '/client_location').done((data) => {
      this.mapController = new MapController(this, $el.find('#map-wrapper'), {
        center: new google.maps.LatLng(data.lat, data.lng)
      });
      this.inputController = new InputController(
        this,
        $el.find('#control'),
        this.mapController
      );
      this.progressBar = new ProgressBar($el.find('#progressbar'));
      console.log('Application: initialized', new Date() - startDate);

      this.route();

    }).fail((err) => window.alert(err));
  }

  route() {
    var parseQuery = (s) => {
        var ret = s.split('=');
        
        return [
          ret[0],
          window.decodeURIComponent(ret[1])
        ];
      },
      splittedHash = window.location.hash.split('?'),
      path = splittedHash[0].split('/')[1],
      query = _.fromPairs((splittedHash[1] || '').split('&').map(parseQuery));

    if (path === 'calc') {
      this.startCalcByQuery(query.request);
    } else if (path === 'result') {
      this.startViewResult(query.path, query.request);
    } else {
      this.moveTo(path);
    }
  }

  startViewResult(path, request) {
    var decoded;

    try {
      request = JSON.parse(request);
      decoded = Walk30mUtils.decodeResult(path);

      this.inputController.applyValues(_.defaults({
        origin: new google.maps.LatLng(request.origin.lat, request.origin.lng)
      }, request)).then(() => {
        this.advancedSettingsController.applyValues(request);

        this.$cancelBtn.show();
        this.mapController.resultVisualizer.addResult({
          taskId: 'viewonly',
          vertices: new google.maps.MVCArray(decoded.map((latLng) => {
            return {
              endLocation: new google.maps.LatLng(latLng.lat, latLng.lng)
            };
          })),
          config: request
        });
        this.viewMap();

      });
    } catch (ex) {
      window.alert(this.getMessage('brokenResult'));
      window.history.pushState(null, '', '/#!/');
    }
  }

  startCalcByQuery(req) {
    try {
      req = JSON.parse(req);

      if (req && req.origin) {
        this.inputController.applyValues(_.defaults({
          origin: new google.maps.LatLng(req.origin.lat, req.origin.lng)
        }, req)).then(() => {
          this.advancedSettingsController.applyValues(req);
          this.startCalculation();
        });
      } else {
        throw new Error('Not sufficient parameters provided.');
      }
    } catch(ex) {
      window.history.pushState(null, '', '/#!/');
    }
  }

  initEvents() {
    this.calcService.addListener('start', _.bind(this.onStartCalculation, this));
    this.calcService.addListener('complete', _.bind(this.onCompleteCalculation, this));
    this.calcService.addListener('progress', _.bind(this.onProgressCalculation, this));
    this.calcService.addListener('warn', _.bind(this.onWarning, this, this.calcService));
    this.calcService.addListener('error', _.bind(this.onError, this, this.calcService));

    this.$goToAboutLink.click(_.bind(this.onClickGoToAboutBtn, this));
    this.$goToAdvancedSettingsLink.click(_.bind(this.onClickGoToAdvancedSettingsBtn, this));
    this.$el.scroll(_.bind(this.onScroll, this));
    this.$gotoTopBtn.click(_.bind(this.moveTo, this, 'top'));
    this.$sendMsgBtn.click(_.bind(this.onClickSendMsgBtn, this));
    this.$execBtn.click(_.bind(this.startCalculation, this));
    this.$cancelBtn.click(_.bind(this.viewMap, this));
  }

  onStartCalculation(task) {
    var serializedCalculation = window.encodeURIComponent(JSON.stringify(task.serialize().config));

    window.history.pushState(null, '', '/#!/calc?request=' + serializedCalculation);
  }

  viewMap() {
    this.inputController.togglePanel(false);
    this.mapController.startView(() => {
      this.inputController.togglePanel(true);
    });
  }

  onProgressCalculation(percent, vertices) {
    this.progressBar.update(percent);
  }

  onError(calcService, message) {
    window.alert([
      this.getMessage('pleaseCheckConditions'),
      message
    ].join('\r\n'));
    this.onExitCalculation();
  }

  onWarning(calcService, message) {
    if (this.lastDenialReload
        && new Date() - this.lastDenialReload < 60000) {
      return;
    }

    if (window.confirm(this.getMessage('askIfReload'))) {
      calcService.stop();
      window.location.reload();
    } else {
      this.lastDenialReload = new Date();
    }
  }

  onCompleteCalculation(vertices, task) {
    var feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Polygon([
          _.map(vertices.getArray(), 'endLocation')
        ]),
        id: task.taskId,
        properties: _.defaults({
          isResult: true,
          vertices: task.vertices.getArray().slice(0),
          task: task
        }, task)
      }),
      resultUrl = Walk30mUtils.createSharedURI(feature),
      newPath = '/' + (resultUrl || '').split('/').slice(3).join('/');

    this.progressBar.update(100);
    window.history.pushState(null, '', newPath);
  }

  moveTo(id) {
    var $target = id && this.$el.find('#' + id);

    if (id !== 'top' && $target && $target.length > 0) {
      this.$page.animate({
        scrollTop: $target.offset().top + 'px'
      }, undefined, 'swing', () => {
        window.history.pushState(null, '', '/#!/' + id);
      });
    } else {
      this.scrollToTop(() => {
        window.history.pushState(null, '', '/#!/');
      });
    }
  }

  onClickGoToAdvancedSettingsBtn(ev) {
    ev.preventDefault();
    this.moveTo('advanced-settings');
  }

  onClickGoToAboutBtn(ev) {
    ev.preventDefault();
    this.moveTo('about');
  }

  onClickSendMsgBtn() {
    var message = this.$el.find('#message textarea').val(),
      uuid = this.$el.find('#message input[name=uuid]').val();

    if (message) {
      this.$sendMsgBtn.addClass('disabled');
      this.sendMessage(message, uuid).then(() => {
          _.delay(() => this.$sendMsgBtn.removeClass('disabled'), 500);
      });
    } else {
      window.alert(this.getMessage('contact'));
    }
  }

  scrollToTop(callback) {
    var fired = false;

    this.$gotoTopBtn.blur();
    this.$page.animate({ scrollTop: '0px' }, undefined, () => {
      // this event fires twice, for the fact that
      // the selector for me.$page matches two elements: html and body.
      if (!fired && _.isFunction(callback)) {
        fired = true;
        callback();
      }
    });
  }

  sendMessage(message, uuid) {
    return $.ajax({
      type: 'POST',
      url: PUBLIC_API_URL_BASE + '/messages',
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify({
        message: uuid + ', ' + message,
        url: window.location.href
      })
    })
    .done(() => window.alert(this.getMessage('thanks')))
    .fail(() => window.alert(this.getMessage('failedToSendMessage')));
  }

  compareGeocoderResultsByDistance(r1, r2) {
    var center = this.mapController.map.getCenter(),
      loc1 = r1.geometry.location,
      loc2 = r2.geometry.location,
      r1Dist = Math.pow(loc1.lat() - center.lat(), 2) + Math.pow(loc1.lng() - center.lng(), 2),
      r2Dist = Math.pow(loc2.lat() - center.lat(), 2) + Math.pow(loc2.lng() - center.lng(), 2);

    return r1Dist > r2Dist? 1: -1;
  }

  startCalculation() {
    var settings = _.defaults(
        this.inputController.getValues(),
        this.advancedSettingsController.getValues());

    this.scrollToTop(() => {
      if (settings.origin) {
        this.doCalculation(settings);

      } else if (settings.address) {
        new google.maps.Geocoder().geocode({
          address: settings.address
        }, (results, status) => {
          var sortedResults = results.sort(_.bind(this.compareGeocoderResultsByDistance, this));

          if (status === google.maps.GeocoderStatus.ZERO_RESULTS) {
            window.alert(this.getMessage('geocoderResultNotFound'));
            return;
          } else if (status !== google.maps.GeocoderStatus.OK) {
            window.alert(status);
            return;
          }

          this.doCalculation(_.defaults({
            origin: sortedResults[0].geometry.location,
            address: GeoUtil.trimGeocoderAddress(sortedResults[0].formatted_address),
            keyword: settings.address
          }, settings));
        });
      } else {
        window.alert(this.getMessage('originLocationIsRequired'));
        this.inputController.$location.focus();
      }
    });
  }

  onExitCalculation(complete) {
    this.inputController.togglePanel(true);
    window.history.pushState(null, '', '/#!/');
    this.progressBar.finalize();

    if (complete) {
      this.$cancelBtn.show();
    }
  }

  doCalculation(settings) {
    this.inputController.togglePanel(false);
    this.progressBar.update(0);
    this.calcService.start(_.defaults(settings, {
      anglePerStep: ({
        SPEED: 20,
        BALANCE: 10,
        PRECISION: 5
      })[settings.preference]
    }));

    this.mapController.startCalculation(this.calcService, _.bind(this.onExitCalculation, this));
  }

  startEditMessage(message, relatedResultId) {
    this.$el.find('#message input[name=uuid]').val(relatedResultId);
    this.$message.val(message);
    this.$message.focus();

    if (message) {
      this.$message.attr('rows', 10);
    }
    this.moveTo('message');
  }

  getMessage(code) {
    return this.messages[code];
  }
}


Application.prototype.onScroll = _.throttle(function() {
  if (this.$el.scrollTop() > 0) {
    this.$gotoTopBtn.fadeIn();
  } else {
    this.$gotoTopBtn.fadeOut();
  }
}, 100);


module.exports = Application;

