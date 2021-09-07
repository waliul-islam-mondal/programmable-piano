	let _initiated = 0;
	let _audio_ctx = null;
	
	let _sample_rate = 16000;
	let _sample_rate_req = 16000;	// Requested sample rate, will be active on audiounit_init
	let _thread_mode = 0;	// 0: normal, play as it is typed, 1: thread, 2: worklet	
	let _note_duration_s = 1.0;	
	let _channel_count = 1;

	let _segment_frame_count = 0;
	let _full_note_frame_count = 0;
	let _buffer_segment = null;	
	let _buffer_full_note = null;
	
	let _q = [], _q_size = 0, _q_pos = 0;
	let _harmonic_amps = [0.125,0.25,0.1,0.64];
	let _event_state = 0;	//1: playing, busy (applicable in event_based thread mode only)
	
	function current_time_ms(){
		return (Date.now() & 0x7FFFFFFF);
	}

	async function sleep(msec) {
		return new Promise(resolve => setTimeout(resolve, msec));
	}

	let t_thread_next_play = 0;
	async function audiounit_run_background_thread(){
		while(1){
			if ( _thread_mode != 1 )break;			
			
			let t_ms_cur = current_time_ms();
			if ( t_thread_next_play >= t_ms_cur ){
				await sleep(t_thread_next_play - t_ms_cur);
				t_thread_next_play = 0;
				audiounit_play_pcm();
				console.log('thread play at = ' + current_time_ms());
			}else{
				await sleep(100);
			}			
		}
	}

	function audiounit_init(){
		_initiated = 1;
		
		_audio_ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:_sample_rate_req});
		_sample_rate = _audio_ctx.sampleRate;
		_note_duration_s += 1.0;	// Otherwise, the function will not be called because of equality
		_channel_count++;
		audiounit_set_note_settings(parseFloat(_note_duration_s - 1.0), parseInt(_channel_count - 1));
		
		_thread_mode++;
		audiounit_set_thread_mode(parseInt(_thread_mode - 1));
		
		console.log('Init settings = ' + _audio_ctx.sampleRate + '/s, ' + _segment_frame_count + ' / ' + _full_note_frame_count);
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
		
		_segment_frame_count = parseInt(_sample_rate * 0.25);		
		_full_note_frame_count = parseInt(_sample_rate * _note_duration_s);
		
		_buffer_segment = _audio_ctx.createBuffer(_channel_count, _segment_frame_count, _sample_rate);
		_buffer_full_note = _audio_ctx.createBuffer(_channel_count, _full_note_frame_count, _sample_rate);			
	}
	
	function audiounit_set_thread_mode(thread_mode){
		if ( thread_mode < 0 || thread_mode > 2 )return;
		if ( thread_mode == _thread_mode )return;
		
		_thread_mode = thread_mode;
		if ( !_initiated )return;
		
		if ( _thread_mode == 1 )audiounit_run_background_thread();
		else if ( _thread_mode == 2 )_event_state = 0;
	}

	function audiounit_segment_ended(){
		if ( _thread_mode != 2 )return;
		_event_state = 0;
		audiounit_play_pcm();
	}
	
	function audiounit_play_pcm(){
		if ( !_initiated )return;
		
		if ( _thread_mode == 0 && _event_state != 0 )return;
		let has_audio = 0;
		let calc_ms = current_time_ms();
		
		for (var channel = 0; channel < _channel_count; channel++) {
			var current_buf = _buffer_segment.getChannelData(channel);
			
			for ( var i = 0; i < _segment_frame_count; i++ ){
				let dt = _q[_q_pos];				
				current_buf[i] = dt;
				_q[_q_pos] = 0.0;
				_q_pos = ( _q_pos + 1 ) % _q_size;
				
				if ( Math.abs(dt) > 0.01 )has_audio = 1;
			}
		}
		
		if ( has_audio == 0 ){
			for ( var i = 0; i < _q_size; i++ ){
				if ( Math.abs(_q[i]) > 0.01 ){
					has_audio = 1;
					break;
				}
			}
			
			if ( has_audio == 0 ){
				if ( _thread_mode == 1 )console.log('ended session...' + current_time_ms());
				return;
			}
		}		
			
		let source = _audio_ctx.createBufferSource();
        source.buffer = _buffer_segment;
		source.connect(_audio_ctx.destination);
		source.start();
	
		if ( _thread_mode == 1 ){
			calc_ms = parseInt(current_time_ms() - calc_ms);			
			t_thread_next_play = current_time_ms() + 250 - calc_ms;			
		}else if ( _thread_mode == 2 ){
			_event_state = 1;
			source.addEventListener('ended', audiounit_segment_ended, false);
		}
	}
	
	function audiounit_play_note(freqs, dur_option){		
		if ( _initiated == 0 )audiounit_init();
		
		let t1 = current_time_ms();
		let current_buf = 0, current_buf2 = 0;
		if ( _thread_mode == 0 ){
			current_buf = _buffer_full_note.getChannelData(0);
			for ( var i = 0; i < _full_note_frame_count; i++ )current_buf[i] = 0;
			
			if ( _channel_count > 1 ){
				current_buf2 = _buffer_full_note.getChannelData(1);
				for ( var i = 0; i < _full_note_frame_count; i++ )current_buf2[i] = 0;
			}
		}
		
		let hrm1_amp = 0.64, hrm2_amp = 0.12, hrm3_amp = 0.11;
		let volume_mult = 0.25, duration_mult = 1.0;
		
		if ( dur_option == 1 )duration_mult = 0.5;	  		// Half note
		else if ( dur_option == 2 )duration_mult = 0.25;	// Quarter note
		else if ( dur_option == 3 )volume_mult = 0.125;		// Half volume
		else if ( dur_option == 4 )volume_mult = 0.5;		// Double volume
		
		if ( dur_option != 0 )console.log("***** duration option = " + dur_option);
		for ( var f = 0; f < freqs.length; f++ ){
			let freq = freqs[f];
			
			let cnt = parseInt(_sample_rate * _note_duration_s * duration_mult);			
			
			let rad_per_sample = (Math.PI*2.0*freq)/cnt;
			let shape_rad_per_sample = Math.PI/(cnt * 2.0);
			let ang_rad = 0.0, shape_rad = Math.PI/2;
			
			for (var i = 0; i < cnt; i++, ang_rad += rad_per_sample, shape_rad += shape_rad_per_sample){
				let v = Math.sin(ang_rad);
				for ( var k = 0; k < _harmonic_amps.length; k++ ){
					if ( _harmonic_amps[k] < 0.1 )continue;
					v += Math.sin(ang_rad * (k+2)) * _harmonic_amps[k];
				}
				
				let amp = Math.sin(shape_rad);
				v = v * amp * amp;
				v = parseFloat(v * volume_mult);
				if ( _thread_mode == 0 ){
					current_buf[i] += v;
					if ( current_buf2 != 0 )current_buf2[i] += v;
				}else{
					_q[(_q_pos + i ) % _q_size] += v;
				}
			}
		}
		
		console.log('note generation time ms: ' + (current_time_ms() - t1));
		if ( _thread_mode == 0 ){			
			let source = _audio_ctx.createBufferSource();
			source.buffer = _buffer_full_note;
			source.connect(_audio_ctx.destination);
			source.start();
		}else if ( _thread_mode == 1 ){
			if ( t_thread_next_play != 0 )return;
			audiounit_play_pcm();
			console.log('started session ....' + current_time_ms());
		}else if ( _thread_mode == 2 ){
			if ( _event_state != 0 )return;
			audiounit_play_pcm();
		}				
	}	
