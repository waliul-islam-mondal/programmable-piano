	let _initiated = 0;
	let _audio_ctx = null;
	
	let _sample_rate = 16000;
	let _sample_rate_req = 16000;	// Requested sample rate, will be active on audiounit_init
	let _play_mode = 0;				// 0: normal, play as it is type, 1: timer, 2: on_end_event	
	let _note_duration_s = 1.0;	
	let _channel_count = 1;

	let _timer_frame_ms = 240;	// Must be multiple of 16, for synchronization with browsers audio_context.currentTime (audio_context.currentTime increases by 8)
	let _timer_frame_count = 0;
	let _event_frame_ms = 240;
	let _event_frame_count = 0;
	let _full_note_frame_count = 0;
	let _buffer_event = null;
	let _buffer_timers = [];
	let _buffer_timers_cur = 0;
	let _buffer_full_notes = [];
	let _buffer_full_notes_cur = 0;
	
	let _q = [], _q_size = 0, _q_pos = 0;
	let _harmonic_amps = [0.125,0.25,0.1,0.64];
	let _event_state = 0;	//1: playing, busy (applicable in event_based play mode only)

	let _timer_next_ms = 0;
	let _timer_note_q = [];
	let _timer_note_q_opts = [];
	
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
				await sleep(50);
				continue;				
			}
			
			let t_ms_cur = current_time_ms();
			if ( ( _timer_next_ms - t_ms_cur ) > 40 ){
				await sleep(_timer_next_ms - t_ms_cur - 40);
			}			
								
			if ( _timer_note_q.length > 0 ){
				audiounit_push_pcm_from_notes(_timer_note_q, _timer_note_q_opts);
				_timer_note_q = [];
				_timer_note_q_opts = [];
				t_ms_cur = current_time_ms();
			}
			
			let has_audio = audiounit_load_pcm_to_buffer(_buffer_timers[_buffer_timers_cur], _timer_frame_count);
			if ( has_audio == 0 && audiounit_buffer_is_empty() == 1 ){
				_timer_next_ms = 0;
				continue;
			}
			
			audiounit_play_buffer(_buffer_timers[_buffer_timers_cur], _timer_next_ms - current_time_ms());
			_buffer_timers_cur = ( _buffer_timers_cur + 1 ) % _buffer_timers.length;
			_timer_next_ms += _timer_frame_ms;
		}
	}

	function audiounit_init(){
		_initiated = 1;
		
		_audio_ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:_sample_rate_req});
		_sample_rate = _audio_ctx.sampleRate;
		_note_duration_s += 1.0;	// Otherwise, the function will not be called because of equality
		_channel_count++;
		audiounit_set_note_settings(parseFloat(_note_duration_s - 1.0), parseInt(_channel_count - 1));
		
		_play_mode++;
		audiounit_set_play_mode(parseInt(_play_mode - 1));
		
		_timer_note_q = [];
		console.log('Init settings = ' + _audio_ctx.sampleRate + '/s, ' + _timer_frame_count + ' / ' + _full_note_frame_count);
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
	
	function audiounit_set_note_settings(dur_s, chnl_cnt){
		if ( dur_s < 0.5 )dur_s = 0.5;
		if ( dur_s > 2.0 )dur_s = 2.0;
		if ( chnl_cnt < 1 )chnl_cnt = 1;
		if ( chnl_cnt > 2 )chnl_cnt = 2;
	
		if ( _note_duration_s == dur_s && _channel_count == chnl_cnt )return;		
		
		_note_duration_s = dur_s;
		_channel_count = chnl_cnt;
		
		if ( !_initiated )return;
		
		_q_size = parseInt(_sample_rate * _note_duration_s);
		
		_q = [];
		for ( var i = 0; i < _q_size; i++ )_q[i] = 0.0;
		_q_pos = 0;
		
		_event_frame_count = parseInt((_sample_rate * _event_frame_ms)/1000);
		_timer_frame_count = parseInt((_sample_rate * _timer_frame_ms)/1000);
		_full_note_frame_count = parseInt(_sample_rate * _note_duration_s);
				
		_buffer_event = _audio_ctx.createBuffer(_channel_count, _event_frame_count, _sample_rate);
		
		for ( var i = 0; i < 2; i++ ){
			_buffer_timers[i] = _audio_ctx.createBuffer(_channel_count, _timer_frame_count, _sample_rate);
		}
		
		for ( var i = 0; i < 10; i++ ){			
			_buffer_full_notes[i] = _audio_ctx.createBuffer(_channel_count, _full_note_frame_count, _sample_rate);			
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
		
		if ( _play_mode == 1 )audiounit_run_background_timer();
		else if ( _play_mode == 2 )_event_state = 0;
	}

	function audiounit_buffer_is_empty(){
		for ( var i = 0; i < _q_size; i++ ){
			if ( Math.abs(_q[i]) > 0.001 )return 0;
		}
		return 1;
	}
	
	function audiounit_event_ended(){
		_event_state = 0;
		if ( _play_mode != 2 )return;
					
		let has_audio = audiounit_load_pcm_to_buffer(_buffer_event, _event_frame_count);
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
			let ff = _audio_ctx.currentTime + 0.01 + parseFloat(t_delay_ms/1000.0);
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
		
		for ( var i = 0; i < frame_count; i++ ){
			let dt = _q[_q_pos];
			if ( Math.abs(dt) > 0.001 )has_audio = 1;
			_q[_q_pos] = 0.0;
			cur_buf[i] = dt;
			if ( chcnt > 1 )cur_buf2[i] = dt;
			_q_pos = ( _q_pos + 1 ) % _q_size;
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
		
			if ( parseFloat(vol_x * freqs.length) > 0.5 ){
				if ( opts == 4 )vol_x = parseFloat(1.0 / freqs.length);
				else vol_x = parseFloat(0.5 / freqs.length);
			}
			
			let cnt = parseInt(_sample_rate * _note_duration_s * dur_x);			
			
			let rad_per_sample = (Math.PI*2.0*freq)/cnt;
			let shape_rad_per_sample = Math.PI/(cnt * 2.0);
			let ang_rad = 0.0, shape_rad = Math.PI/2;
			
			for (var i = 0; i < cnt; i++, ang_rad += rad_per_sample, shape_rad += shape_rad_per_sample){
				let v = Math.sin(ang_rad);
				let amp = Math.sin(shape_rad);
				
				for ( var k = 0; k < _harmonic_amps.length; k++ ){
					if ( _harmonic_amps[k] >= 0.01 )v += Math.sin(ang_rad * (k+2)) * _harmonic_amps[k];
				}				
				
				_q[(_q_pos + i) % _q_size] += parseFloat(v * amp * amp * vol_x);
			}
		}
	}
	
	function audiounit_play_notes(freqs, opts){
		if ( _initiated == 0 )audiounit_init();
		if ( freqs.length <= 0 )return;
		
		let t1 = current_time_ms();
		if ( _play_mode == 0 ){
			audiounit_push_pcm_from_notes(freqs, opts);		
			audiounit_load_pcm_to_buffer(_buffer_full_notes[_buffer_full_notes_cur], _full_note_frame_count);
			audiounit_play_buffer(_buffer_full_notes[_buffer_full_notes_cur], 0);
			_buffer_full_notes_cur = ( _buffer_full_notes_cur + 1 ) % _buffer_full_notes.length;			
		}else if ( _play_mode == 1 ){
			let p = _timer_note_q.length;
			for ( var i = 0; i < freqs.length; i++ ){
				_timer_note_q_opts[p] = opts[i];
				_timer_note_q[p++] = freqs[i];				
			}
			
			if ( _timer_next_ms == 0 ){
				audiounit_push_pcm_from_notes(_timer_note_q, _timer_note_q_opts);
				_timer_note_q = [];
				_timer_note_q_opts = [];
				
				audiounit_load_pcm_to_buffer(_buffer_timers[_buffer_timers_cur], _timer_frame_count);				
				audiounit_play_buffer(_buffer_timers[_buffer_timers_cur], 0);
				_buffer_timers_cur = ( _buffer_timers_cur + 1 ) % _buffer_timers.length;
				_timer_next_ms = current_time_ms() + _timer_frame_ms;
			}
		}else if ( _play_mode == 2 ){
			audiounit_push_pcm_from_notes(freqs, opts);
			if ( _event_state != 0 )return;
			_event_state = 1;
			audiounit_load_pcm_to_buffer(_buffer_event, _event_frame_count);
			audiounit_play_buffer(_buffer_event, 0);
		}
	}	

/*	function audiounit_test(){
		if ( !_initiated )return;
		
		audiounit_push_pcm_from_notes([440],[0]);
		for ( var i = 0; i < 4; i++ ){
			let source = _audio_ctx.createBufferSource();
			for (var channel = 0; channel < _channel_count; channel++) {
				var current_buf = _buffer_timers[i].getChannelData(channel);
			
				for ( var j = 0; j < _timer_frame_count; j++ ){
					current_buf[j] = _q[i * _timer_frame_count + j];				
					_q[i * _timer_frame_count + j] = 0.0;
				}
			}
		
			source.buffer = _buffer_timers[i];
			source.connect(_audio_ctx.destination);
			source.start(parseFloat(0.05 + 0.25 * i));
		}
	}*/