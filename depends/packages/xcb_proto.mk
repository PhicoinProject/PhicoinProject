package=xcb_proto
$(package)_version=1.10
$(package)_download_path=http://xcb.freedesktop.org/dist
$(package)_file_name=xcb-proto-$($(package)_version).tar.bz2
$(package)_sha256_hash=7ef40ddd855b750bc597d2a435da21e55e502a0fefa85b274f2c922800baaf05

define $(package)_set_vars
  $(package)_config_opts=--disable-shared
  $(package)_config_opts_linux=--with-pic
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install-exec install-data || \
  (cd xcbgen && mkdir -p $($(package)_staging_dir)/root/project/git/PhicoinProject/depends/x86_64-linux-gnu/local/lib/python3.13/dist-packages/xcbgen && \
   cp -f __init__.py error.py expr.py matcher.py state.py xtypes.py $($(package)_staging_dir)/root/project/git/PhicoinProject/depends/x86_64-linux-gnu/local/lib/python3.13/dist-packages/xcbgen/ 2>/dev/null || true) && \
  $(MAKE) DESTDIR=$($(package)_staging_dir) -k install || true
endef

define $(package)_postprocess_cmds
  find -name "*.pyc" -delete && \
  find -name "*.pyo" -delete
endef
