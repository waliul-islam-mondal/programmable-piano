	let _initiated = 0;
	let _audio_ctx = null;
	
	let _sample_rate = 16000;
	let _sample_rate_req = 16000;	// Requested sample rate, will be active on audiounit_init
	let _play_mode = 0;				// 0: normal, play immediate, 1: timer, 2: on_end_event			
	let _channel_count = 1;

	let _volume = 1.0;
	let _note_duration_ms = 1000;	// 0: continuous tone, for flute or organ
	let _timer_frame_ms = 160;		// Must be multiple of 16, for synchronization with browsers audio_context.currentTime (audio_context.currentTime increases by 8)
	let _event_frame_ms = 160;
	
	let _buffer_full_notes = [];
	let _buffer_event = null;
	let _buffer_timers = [];
	let _buffer_timers_cur = 0;	
	let _buffer_full_notes_cur = 0;

	let _q = [], _q_pos = 0;
	let _harmonic_amps = [0.125,0.25,0.1,0.64];
	let _event_state = 0;	//1: playing, busy (applicable in event_based play mode only)

	let _timer_next_ms = 0;
	let _timer_note_q = [];
	let _timer_note_q_opts = [];
	
	let _continuous_note_q = [];
	
	function current_time_ms(){
		return (Date.now() & 0x7FFFFFFF);
	}

	async function sleep(msec) {
		return new Promise(resolve => setTimeout(resolve, msec));
	}
	
	async function audiounit_run_background_timer(){
		while(1){
			if ( _play_mode != 1 )break;			
			if ( _timer_next_ms <= 0 ){
				await sleep(40);
				continue;				
			}
			
			let t_ms = current_time_ms();
			if ( ( _timer_next_ms - t_ms ) > 50 ){
				await sleep(_timer_next_ms - t_ms - 50);
			}
			
			if ( audiounit_is_continuous_tone_enabled() == 1 ){
				t_ms = current_time_ms();
				audiounit_push_continuous_notes();
//				console.log('continuous time = ' + parseInt(current_time_ms() - t_ms));
			}else if ( _timer_note_q.length > 0 ){
				audiounit_push_pcm_from_notes(_timer_note_q, _timer_note_q_opts);
				_timer_note_q = [];
				_timer_note_q_opts = [];
			}
			
			let has_audio = audiounit_load_pcm_to_buffer(_buffer_timers[_buffer_timers_cur], parseInt((_sample_rate * _timer_frame_ms)/1000));
			if ( has_audio == 0 && audiounit_buffer_is_empty() == 1 ){
				_timer_next_ms = 0;
				continue;
			}
			
			t_ms = current_time_ms();
			if ( _timer_next_ms > t_ms ){
				await sleep(_timer_next_ms - t_ms);
			}
			
			audiounit_play_buffer(_buffer_timers[_buffer_timers_cur], 0);
			_buffer_timers_cur = ( _buffer_timers_cur + 1 ) % _buffer_timers.length;
			_timer_next_ms += _timer_frame_ms;
		}
	}

	function audiounit_init(){
		_initiated = 1;
				
		_audio_ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:_sample_rate_req});
		_sample_rate = _audio_ctx.sampleRate;
		_note_duration_ms += 1;	// Otherwise, the function will not be called because of equality
		_channel_count++;
		audiounit_set_note_settings(_note_duration_ms - 1, _channel_count - 1);
		
		_play_mode++;
		audiounit_set_play_mode(parseInt(_play_mode - 1));
		
		_continuous_note_q = [];
		_timer_note_q = [];	
		
		console.log('Init settings = ' + _audio_ctx.sampleRate + '/s, ' + parseInt((_sample_rate * _timer_frame_ms)/1000) + ' / ' + parseInt((_sample_rate * _note_duration_ms)/1000));
	}

	function audiounit_is_continuous_tone_enabled(){
		if ( _note_duration_ms <= 0 )return 1;
		return 0;
	}
	
	function audiounit_set_volume(vol){
		if ( vol < 0.1 )_volume = 0.1;
		else if ( vol > 1.0 )_volume = 1.0;
		else _volume = vol;
	}
	
	function audiounit_set_harmonic_amps(hh){
		_harmonic_amps = [];
		let n = 0;
		for ( var i = 0; i < hh.length && i < 6; i++ ){
			let h = parseFloat(hh[i]);
			if ( h < 0 )h = parseFloat(0-h);
			if ( h > 1.0 )h = 1.0;			
			_harmonic_amps[n++] = h;
		}
	}
	
	function audiounit_set_sample_rate(rt){
		_sample_rate_req = rt;
		if ( _initiated )alert('This sample rate will be active after you click start button.');
	}
	
	function audiounit_set_note_settings(dur_ms, chnl_cnt){
		dur_ms = parseInt(dur_ms);
		chnl_cnt = parseInt(chnl_cnt);
		
		if ( dur_ms == 0 );
		else if ( dur_ms < 500 )dur_ms = 500;
		else if ( dur_ms > 2000 )dur_ms = 2000;
		
		if ( chnl_cnt < 1 )chnl_cnt = 1;
		else if ( chnl_cnt > 2 )chnl_cnt = 2;
	
		if ( _note_duration_ms == dur_ms && _channel_count == chnl_cnt )return;		
		
		_note_duration_ms = dur_ms;
		_channel_count = chnl_cnt;
		
		if ( !_initiated )return;
				
		let qlen = parseInt((_sample_rate * _note_duration_ms)/1000);
		if ( _note_duration_ms == 0 )qlen = parseInt(_sample_rate * 2);
		
		_q = [];
		for ( var i = 0; i < qlen; i++ )_q[i] = 0.0;
		_q_pos = 0;
		
		_buffer_event = _audio_ctx.createBuffer(_channel_count, parseInt((_sample_rate * _event_frame_ms)/1000), _sample_rate);
		
		for ( var i = 0; i < 2; i++ ){
			_buffer_timers[i] = _audio_ctx.createBuffer(_channel_count, parseInt((_sample_rate * _timer_frame_ms)/1000), _sample_rate);
		}
		
		for ( var i = 0; i < 10 && _note_duration_ms > 0; i++ ){
			_buffer_full_notes[i] = _audio_ctx.createBuffer(_channel_count, parseInt((_sample_rate * _note_duration_ms)/1000), _sample_rate);			
		}
		
		_buffer_timers_cur = 0;
		_buffer_full_notes_cur = 0;
	}
	
	function audiounit_set_play_mode(play_mode){
		if ( play_mode < 0 || play_mode > 2 )return;
		if ( play_mode == _play_mode )return;
		
		_play_mode = play_mode;
		_timer_note_q = [];
		
		if ( !_initiated )return;
		
		if ( _play_mode == 0 && _note_duration_ms == 0 ){
			_note_duration_ms = 1000;
			alert('note duration set to 1000 ms');
		}
		
		if ( _play_mode == 1 )audiounit_run_background_timer();
		else if ( _play_mode == 2 )_event_state = 0;
	}

	function audiounit_buffer_is_empty(){
		let qlen = _q.length;
		for ( var i = 0; i < qlen; i++ ){
			if ( Math.abs(_q[i]) > 0.001 )return 0;
		}
		return 1;
	}
	
	function audiounit_event_ended(){
		_event_state = 0;
		if ( _play_mode != 2 )return;
		
		if ( audiounit_is_continuous_tone_enabled() != 0 ){
			audiounit_push_continuous_notes();
		}

		let has_audio = audiounit_load_pcm_to_buffer(_buffer_event, parseInt((_sample_rate * _event_frame_ms)/1000));
		if ( has_audio == 0 ){
			if ( audiounit_buffer_is_empty() == 1 )return;
		}
		
		_event_state = 1;
		audiounit_play_buffer(_buffer_event, 0);
	}
	
	function audiounit_play_buffer(buf, t_delay_ms){
		t_delay_ms = parseInt(t_delay_ms);
		
		let source = _audio_ctx.createBufferSource();
        source.buffer = buf;
		source.connect(_audio_ctx.destination);
		
		if ( _play_mode != 2 && t_delay_ms > 0 ){
			let ff = _audio_ctx.currentTime + parseFloat(t_delay_ms/1000.0);
			source.start(ff);
		}else source.start();
		
		if ( _play_mode == 2 )source.addEventListener('ended', audiounit_event_ended, false);
	}
	
	function audiounit_load_pcm_to_buffer(buf, frame_count){
		let chcnt = buf.numberOfChannels;
		let cur_buf = buf.getChannelData(0);
		let cur_buf2 = null;
		if ( chcnt > 1 )cur_buf2 = buf.getChannelData(1);
		let has_audio = 0;
		let qlen = _q.length;
		
		for ( var i = 0; i < frame_count; i++ ){
			let dt = _q[_q_pos];
			if ( Math.abs(dt) > 0.001 )has_audio = 1;
			_q[_q_pos] = 0.0;
			cur_buf[i] = dt;
			if ( chcnt > 1 )cur_buf2[i] = dt;
			_q_pos = ( _q_pos + 1 ) % qlen;
		}
		
		return has_audio;
	}
		
	function audiounit_push_pcm_from_notes(freqs, opts){
		if ( freqs.length <= 0 )return;		
		for ( var f = 0; f < freqs.length; f++ ){
			let freq = freqs[f];		
			let vol_x = 0.25, dur_x = 1.0;
		
			let opt2 = opts[f];
			if ( opt2 == 1 )dur_x = 0.5;	  		// Half note
			else if ( opt2 == 2 )dur_x = 0.25;		// Quarter note
			else if ( opt2 == 3 )vol_x = 0.125;		// Half volume
			else if ( opt2 == 4 )vol_x = 0.5;		// Double volume
			
			vol_x = parseFloat(vol_x * _volume);			
			if ( parseFloat(vol_x * freqs.length) > 1.0 )vol_x = parseFloat(1.0 / freqs.length);			
						
			let cnt = parseInt((_sample_rate * _note_duration_ms * dur_x)/1000);
			
			let rad_per_sample = parseFloat((Math.PI*2.0*freq)/_sample_rate);
			let shape_rad_per_sample = parseFloat(Math.PI/(cnt * 2.0));
			let ang_rad = 0.0, shape_rad = parseFloat(Math.PI/2);
			let qlen = _q.length;
			
			for (var i = 0; i < cnt; i++, ang_rad += rad_per_sample, shape_rad += shape_rad_per_sample){
				let v = Math.sin(ang_rad);
				let amp = Math.sin(shape_rad);
				
				for ( var k = 0; k < _harmonic_amps.length; k++ ){
					if ( _harmonic_amps[k] >= 0.01 )v += Math.sin(ang_rad * (k+2)) * _harmonic_amps[k];
				}				
				
				_q[(_q_pos + i) % qlen] += parseFloat(v * amp * amp * amp * vol_x);
			}
		}
	}

	function audiounit_play_notes(freqs, opts){
		if ( _initiated == 0 )audiounit_init();
		if ( freqs.length <= 0 )return;
		
		if ( _play_mode == 0 ){
			audiounit_push_pcm_from_notes(freqs, opts);		
			audiounit_load_pcm_to_buffer(_buffer_full_notes[_buffer_full_notes_cur], parseInt((_sample_rate * _note_duration_ms)/1000));
			audiounit_play_buffer(_buffer_full_notes[_buffer_full_notes_cur], 0);
			_buffer_full_notes_cur = ( _buffer_full_notes_cur + 1 ) % _buffer_full_notes.length;			
		}else if ( _play_mode == 1 ){
			let p = _timer_note_q.length;
			for ( var i = 0; i < freqs.length; i++ ){
				_timer_note_q_opts[p] = opts[i];
				_timer_note_q[p++] = freqs[i];				
			}
			
			if ( _timer_next_ms != 0 )return;
			let t_ms = current_time_ms() + 60;
			if ( ( t_ms % 16 ) != 0 )t_ms += ( 16 - ( t_ms % 16 ));
			_timer_next_ms = t_ms;
		}else if ( _play_mode == 2 ){
			audiounit_push_pcm_from_notes(freqs, opts);
			if ( _event_state != 0 )return;
			_event_state = 1;
			audiounit_load_pcm_to_buffer(_buffer_event, parseInt((_sample_rate * _event_frame_ms)/1000));
			audiounit_play_buffer(_buffer_event, 0);
		}
	}	

	function audiounit_update_continuous_notes(freqs){		
		if ( _initiated == 0 )audiounit_init();
		if ( _play_mode == 0 )return;
		if ( audiounit_is_continuous_tone_enabled() != 1 )return;
		
		let ff = [];
		for ( var i = 0; i < _continuous_note_q.length; i++ ){
			if ( _continuous_note_q[i] < 0 )continue;
			if ( freqs.indexOf(_continuous_note_q[i]) < 0 )_continuous_note_q[i] = parseInt(0 - _continuous_note_q[i]);
		}
		
		for ( var i = 0; i < freqs.length; i++ ){
			if ( _continuous_note_q.indexOf(freqs[i]) < 0 )_continuous_note_q[_continuous_note_q.length] = freqs[i];			
		}
		
		if ( _play_mode == 1 ){
			if ( _timer_next_ms != 0 )return;
			let t_ms = current_time_ms() + 60;
			if ( ( t_ms % 16 ) != 0 )t_ms += ( 16 - ( t_ms % 16 ));
			_timer_next_ms = t_ms;
		}else if ( _play_mode == 2 ){			
			if ( _event_state != 0 )return;
			_event_state = 1;
			audiounit_push_continuous_notes();
			audiounit_load_pcm_to_buffer(_buffer_event, parseInt((_sample_rate * _event_frame_ms)/1000));
			audiounit_play_buffer(_buffer_event, 0);
		}
	}	
	
	function audiounit_push_continuous_notes(){
		if ( audiounit_is_continuous_tone_enabled() != 1 )return;
		if ( _play_mode != 1 && _play_mode != 2 )return;
		if ( _continuous_note_q.length <= 0 )return;
		
		let qlen = _q.length;
		let vmult = parseFloat(0.25 * _volume);
		if ( parseFloat( _continuous_note_q.length * vmult ) > 1.0 )vmult = parseFloat(1.0/_continuous_note_q.length);
		
		let sample_cnt = parseInt((_sample_rate * _timer_frame_ms)/1000);
		if ( _play_mode == 2 )sample_cnt = parseInt((_sample_rate * _event_frame_ms)/1000);
		
		for ( var p = _continuous_note_q.length - 1; p >= 0; p-- ){
			let freq = _continuous_note_q[p], tone_end = 0;
			if ( freq < 0 ){
				freq = parseInt(0 - freq);
				tone_end = 1;
				_continuous_note_q.splice(p,1);
			}
			
			let cnt = sample_cnt;			
			
			let rad_per_sample = parseFloat((Math.PI*2.0*freq)/_sample_rate);
			let shape_rad_per_sample = Math.PI/(cnt * 2.0);
			let ang_rad = rad_per_sample * _q_pos, shape_rad = Math.PI/2;
			
			if ( tone_end != 0 ){
				cnt = parseInt(cnt * 2);
				shape_rad_per_sample = parseFloat(shape_rad_per_sample/2);
			}else{
				shape_rad = 0.0;
				shape_rad_per_sample = ( Math.PI * 2.0)/cnt;
			}
			
			for (var i = 0; i < cnt; i++, ang_rad += rad_per_sample, shape_rad += shape_rad_per_sample){
				let v = Math.sin(ang_rad);
				let amp = Math.sin(shape_rad);
			
				for ( var k = 0; k < _harmonic_amps.length; k++ ){
					if ( _harmonic_amps[k] < 0.01 )continue;
					v += ( Math.sin(ang_rad * (k+2)) * _harmonic_amps[k] );
				}
				
				if ( tone_end == 0 )_q[(_q_pos + i) % qlen] += parseFloat(v * vmult * (0.85 + 0.15 * amp ));
				else _q[(_q_pos + i) % qlen] += parseFloat(v * vmult * amp);
			}			
		}
	}
